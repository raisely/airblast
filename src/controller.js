const serializeError = require('serialize-error');
const tc = require('timezonecomplete');
const _ = require('lodash');

const Datastore = require('./services/datastore');
const Pubsub = require('./services/pubsub');

const { AppError } = require('./helpers/errors');

const DEFAULT_RETRY = [0.5, 1, 2, 12, 24, 48, 96, 168];

const DEFAULT_OPTIONS = {};

/**
  * Controller for handling cloud function background jobs
  * Provides handlers for receiving data from a post, saving that to datastore
  * and running a background job to process it
  * It also provides retry handling triggered by a request to retry handling
  *
  * Implementations simply need to extend this class and define hooks for validation
  * and processing
  *
  * Receiving Hooks
  * @method validate({ data* }) Called to validate a payload before saving to datastore
  * @method beforeSave({ data* }) Called during post or enqueue
  * @method afterSave({ key, data, pubsubId }) Called during post or enqueue after object is saved
  *
  * Processing Hooks
  * @method beforeProcess({ record*, data, key* }) Called prior to processing a data
  * @method process({ record*, data, key* }) Called to perform processing on the data
  * @method afterProcess({ record, data, key* }) Called after a record has been processed and marked
  * processed
  *
  * Changes to arguments marked with * will be saved to datastore
  * NOTE if you change record during a call to the process hook, that change will be pesisted
  * **even if** an error is thrown by the processor
  * WARNING if you change the value of key, you will end up with duplicate records
  *
  * Hook parameters
  * @param {object} data the data received by post / enqueue for processing
  * @param {object} key Datastore key that the record and data is saved under
  * @param {object} pubsubId id that the data is published to pubsub under
  * @param {object} record metadata record that the data is saved in containing retry information
  *
  * Metadata stored on record
  * @param {Date} createdAt The date the record was created (may be supplied in data)
  * @param {Date} nextAttempt The next time processing the record should be attempted
  * @param {Date} lastAttempt The last time processing was attempted on the record
  * @param {object} lastError serializeError representation of the most recent error in processing
  * @param {object} firstError serializeError representation of the error encounters on first
  * attempt to process
  * @param {integer} retries The number of retries the record has taken to process
  *
  */
class AirblastController {
	/**
	  * @param {string} opts.name The name of the controller (Default: guessed from the class name)
	  * @param {string} opts.topic Pubsub topic to publish jobs on (Default: opts.name)
	  * @param {string} opts.kind The kind of entity to save records in Datastore (Default: opts.name)
	  * @param {boolean} opts.wrapInData Expect the http payload to be inside the req.body.data
	  * (Defeault: false)
	  * @param {number[]} opts.retries Array of retry periods (in hours)
	  * @param {number} opts.maxProcessingTime The maximum grace period for a job to finish
	  *  processing before retrying (in minutes) (Default: 5)
	  * @param {function} log Send log messages to this function (Default: false)
	  * @param {object} datastore Datastore configuration options
	  * @param {object} pubsub Pubsub configuration options
	  * @param {function|string} authenticate Authorization Bearer token authentication
	  * for http requests either a string to compare the token to, or a function that
	  * returns truthy if the request is authentic
	  */
	constructor(opts) {
		const options = Object.assign({}, DEFAULT_OPTIONS, this.constructor.options, opts);

		this.options = options;

		this.name = options.name;
		if (!options.name) {
			let { name } = this.constructor;
			if (name.endsWith('Controller')) name = name.slice(0, -10);
			this.name = name;
		}
		this.topic = options.topic || this.name;
		this.kind = options.kind || this.name;
		this.retries = options.retries || DEFAULT_RETRY;
		this.maxProcessingTime = options.maxProcessingTime || 5 * 60;
		this.log = options.log || _.noop;
		this.wrapInData = options.wrapInData;

		this.datastore = new Datastore(options.datastore || {});
		this.pubsub = new Pubsub(options.pubsub || {});

		if (options.authenticate) {
			this.authenticate = _.isString(options.authenticate) ?
				(token => (token === options.authenticate)) :
				options.authenticate;
		}

		// Bind http requests to this controller instance
		['http', 'httpRetry'].forEach((method) => {
			this[method] = this[method].bind(this);
		});
	}

	/**
	  * Enqueues data for processing by this controller
	  * (will cause the beforeSave and afterSave hooks to be called)
	  * @param {object} data Data to enqueue for processing
	  * @param {Date} runAt Date to run at (immediately if null)
	  */
	async enqueue(data, runAt) {
		await this.hook('beforeSave', { data });

		// Save to datastore
		const { key, record } = await this.datastore.save(this.kind, data, { runAt });

		let pubsubId;
		// If not delayed, run immediately
		if (!runAt) pubsubId = await this.pubsub.publish(this.topic, key, this.name);

		this.log(`(${this.name} ${record.uuid}) Record saved and queued`);

		// Publish
		await this.hook('afterSave', { key, data, pubsubId });

		return pubsubId;
	}

	async get(req) {
		return {
			status: 200,
			body: {
				message: `${this.name} running`,
				platform: 'Airblast',
			},
		};
	}

	/**
	  * Handler for receiving data to enqueu for processing via http post
	  * @param {object} req Express request to process
	  * @return {object} { status, body } The status code and body to return
	  */
	async post(req) {
		if (!req.body || JSON.stringify(req.body) === '{}') {
			return {
				status: 200,
				body: { message: 'Received empty webhook body (assuming this was a test)' }
			}
		}

		const data = this.wrapInData ? req.body.data : req.body;

		await this.hook('validate', { data });
		await this.enqueue(data, req.body.runAt);

		// return success
		return {
			status: 200,
			body: {
				data,
			},
		};
	}

	/**
	  * Shortcut to load a record from the datastore with the given key
	  */
	async load(key) {
		return this.datastore.get(key);
	}

	/**
	  * Receives a job from pubsub for processing
	  * Causes beforeProcess, process and afterProcess hooks to be called
	  * @param {StringBuffer} input message from pubsub
	  */
	async pubsubMessage(input) {
		const pubsubMessage = this.pubsub.constructor.decodeMessage(input);

		if (pubsubMessage.name !== this.name) {
			throw new Error(`Received pubsub message not meant for this controller (message name: ${pubsubMessage.name}, controller name: ${this.name})`);
		}

		const { key } = pubsubMessage;
		const record = await this.load(key);

		// Avoid repeat processing
		if (record.processedAt) return;

		try {
			await this.hook('beforeProcess', { record, data: record.data, key });

			await this.datastore.update(pubsubMessage.key, {
				lastAttempt: new Date(),
			});

			this.log(`(${this.name} ${record.uuid}) Record processing ...`);
			await this.hook('process', { record, data: record.data, key });

			// update processedAt
			record.processedAt = new Date();
		} catch (e) {
			this.log(`(${this.name} ${record.uuid}) Processing error`);
			// eslint-disable-next-line no-console
			console.error(e);

			// Save any errors encountered
			record.lastError = JSON.stringify(serializeError(e));
			if (!record.firstError) {
				record.firstError = record.lastError;
			}
		}

		await this.datastore.update(pubsubMessage.key, record);
		this.log(`(${this.name} ${record.uuid}) Record processed`);

		await this.hook('afterProcess', { record, data: record.data, key });
	}

	/**
	  * Checks all current records in datastore for retries
	  */
	async retry() {
		// Retry failures
		const query = this.datastore.createQuery([this.kind])
			.filter('processedAt', null)
			.filter('failedAt', null)
			.filter('nextAttempt', '<=', new Date());

		await this.findAndRetry(query);

		return { status: 200, body: { status: 'ok' } };
	}

	/**
	  * @param {object} query query to find records to check for retry
	  */
	async findAndRetry(query) {
		const records = await this.datastore.runQuery(query);

		const promises = [];
		records[0].forEach((record) => {
			promises.push(this.queueRetry(record));
		});

		return Promise.all(promises);
	}

	/**
	  * Handle setting retries for a record
	  * if lastAttempt is since nextAttempt
	  * 	Sets the nextAttempt date and increments retry counter
	  * if nextAttempt is in the past and lastAttempt is before it
	  *		Publish the record to be processedAt
	  * if max retry attempts have been exceeded
	  *		Set failedAt
	  * @param {object} record record to process for retrying
	  */
	async queueRetry(record) {
		// If a record has failed to process since it's next attempt time
		// add a retry, set a nextAttempt date
		if (record.lastAttempt && (record.nextAttempt <= record.lastAttempt)) {
			const interval = this.retries[record.retries];

			if (interval) {
				const newTime = new tc.DateTime(record.lastAttempt.toISOString()).add(tc.hours(interval));
				record.nextAttempt = new Date(newTime.toIsoString());
				record.retries += 1;

				this.log(`(${this.name} ${record.uuid}) Record scheduled for retry #${record.retries} at ${newTime.toIsoString()}`);
			} else {
				record.failedAt = record.lastAttempt;
			}

			await this.datastore.update(
				record[this.datastore.getDatastore().KEY],
				record,
			);
		}

		const completeWindow = new Date(tc.now().sub(tc.seconds(this.maxProcessingTime)).toIsoString());

		// If the nextAttempt is now (or has passed), queue it
		if (((record.lastAttempt == null) || (record.lastAttempt <= completeWindow)) &&
			(record.nextAttempt <= new Date()) && (record.createdAt < completeWindow)) {
			await this.pubsub.publish(
				this.topic,
				record[this.datastore.getDatastore().KEY],
				this.name,
			);

			this.log(`(${this.name} ${record.uuid}) Record retry queued`);
		}
	}

	/**
	  * Execute hook on this instance by the given name with the opts
	  * @param {string} name Name of the hook
	  * @param {object} opts Options to pass to hook
	  */
	async hook(name, opts) {
		if (this[name]) return this[name](opts);
		return null;
	}

	/**
	  * HTTP handler for incoming requests
	  * @param {object} req Express request object
	  * @param {object} res Express response object
	  */
	async http(req, res) {
		return this.httpHandler(req, res);
	}

	/**
	  * HTTP handler for retry requests
	  * Causes retry method to be invoked
	  * @param {object} req Express request object
	  * @param {object} res Express response object
	  */
	async httpRetry(req, res) {
		return this.httpHandler(req, res, 'retry');
	}

	/**
	  * Handler for http requests
	  * Checks for authentication (if this.authenticate is set)
	  * and passes the request to this[name](req)
	  * Handler should return an object { status, body } containig
	  * the object to return and the status code
	  *
	  * @param {object} req Express request object
	  * @param {object} res Express response object
	  * @param {string} name Name of the handler function for the request (default: req.method)
	  */
	async httpHandler(req, res, name) {
		try {
			res.set('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT');
			res.set('Access-Control-Allow-Headers', 'Access-Control-Allow-Headers, Origin, Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers');

			const auth = req.headers.authorization || req.headers.Authorization;

			if (this.authenticate) {
				const [bearer, token] = auth ? auth.split(' ') : ['bearer', null];

				if (bearer.toLowerCase() !== 'bearer') {
					throw new AppError(401, 'unauthorized', 'Unknown authorization type (expected Authorization: bearer)');
				}
				if (!(token && this.authenticate(token))) {
					throw new AppError(401, 'Unauthorized', 'The token provided is not valid');
				}

				if (!(auth && (await this.authenticate(token)))) {
					throw new AppError(401, 'unauthorized', 'The token provided is not valid.');
				}
			}

			const handler = name || req.method.toLowerCase();

			if (!this[handler]) throw new AppError(404, 'not found', 'Resource cannot be found');

			const result = await this[handler](req);

			res.status(result.status).send(result.body);
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error(error);
			const body = error.body || error.message;
			res.status((error && error.status) || 500).send(error.body);
		}
	}
}

Object.assign(AirblastController, { AppError });

module.exports = AirblastController;
