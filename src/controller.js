const serializeError = require('serialize-error');
const tc = require('timezonecomplete');
const _ = require('lodash');

const Datastore = require('./services/datastore');
const Pubsub = require('./services/pubsub');

const { AppError } = require('./helpers/errors');

// Special properties
// createdAt The date the record was created
// nextAttempt The next time a record should be attempted
// lastAttempt Set when processor is starting
// lastError The most recent error encountered
// firstError The first error encountered in processing
// retries The number of retries the record has taken


// Default retry period (in hours)
// Retries at half an hour through to 1 week
const DEFAULT_RETRY = [0.5, 1, 2, 12, 24, 48, 96, 168];

const DEFAULT_OPTIONS = {
	autoCreateTopic: true,
};

class AirblastController {
	constructor(opts) {
		const options = Object.assign({}, DEFAULT_OPTIONS, opts, this.constructor.options);
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
		this.maxProcessingTime = options.masProcessingTime || 5 * 60;
		this.log = options.log || _.noop;

		this.datastore = new Datastore(options.datastore || {});
		this.pubsub = new Pubsub(options.pubsub || {}, options.autoCreateTopic);

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

	async post(req) {
		const { data } = req.body;

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

	async pubsubMessage(input) {
		const pubsubMessage = this.pubsub.constructor.decode(input);

		if (input.name !== this.name) {
			throw new Error(`Received pubsub message not meant for this controller (message name: ${input.name}, controller name: ${this.name})`);
		}

		const record = this.datastore.get(pubsubMessage.key);

		// Avoid repeat processing
		if (record.processedAt) return;

		try {
			await this.hook('beforeProcess', { record, data: record.data });

			await this.datastore.update(pubsubMessage.key, {
				lastAttempt: new Date(),
			});

			this.log(`(${this.name} ${record.uuid}) Record processing ...`);
			await this.hook('process', { record, data: record.data });

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

		await this.hook('afterProcess', { record, data: record.data });
	}

	async retry() {
		const completeWindow = new Date(tc.now().sub(tc.seconds(this.maxProcessingTime)).toIsoString());

		// Retry failures
		let query = this.datastore.createQuery([this.kind])
			.filter('processedAt', null)
			.filter('failedAt', null)
			.filter('nextAttempt', '<=', new Date())
			.filter('lastAttempt', '<=', completeWindow);

		await this.findAndRetry(query);

		// Queue first attempts with delayed starts
		query = this.datastore.createQuery([this.kind])
			.filter('processedAt', null)
			.filter('failedAt', null)
			.filter('nextAttempt', '<=', new Date())
			.filter('lastAttempt', null)
			.filter('createdAt', '<', completeWindow);

		await this.findAndRetry(query);
	}

	async findAndRetry(query) {
		const records = await this.datastore.runQuery(query);

		const promises = [];
		records[0].forEach((record) => {
			promises.push(this.queueRetry(record));
		});
	}

	async queueRetry(record) {
		// If a record has failed to process since it's next attempt time
		// add a retry, set a nextAttempt date
		if (record.lastAttempt && (record.nextAttempt <= record.lastAttempt)) {
			const interval = this.retries[record.retries];

			if (interval) {
				const newTime = new tc.DateTime(record.lastAttempt.toISOString()).add(tc.hours(interval));
				record.nextAttempt = new Date(newTime.toIsoString());
				record.retries += 1;

				this.log(`(${this.name} ${record.uuid}) Record scheduled for retry #${record.retries}`);
			} else {
				record.failedAt = record.lastAttempt;
			}

			await this.datastore.update(
				record[this.datastore.getDatastore().KEY],
				_.pick(record, ['nextAttempt', 'retries', 'failedAt']),
			);
		}

		// If the nextAttempt is now (or has passed), queue it
		if ((record.lastAttempt == null) || (record.nextAttempt <= new Date())) {
			await this.pubsub.publish(
				this.topic,
				{ key: record[this.datastore.getDatastore().KEY] },
				this.name,
			);

			this.log(`(${this.name} ${record.uuid}) Record retry queued`);
		}
	}

	async hook(name, opts) {
		if (this[name]) return this[name](opts);
		return null;
	}

	async http(req, res) {
		return this.httpHandler(req, res);
	}

	async httpRetry(req, res) {
		return this.httpHandler(req, res, 'retry');
	}

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
			res.status(error.status || 500).send(error.body);
		}
	}
}

module.exports = AirblastController;
