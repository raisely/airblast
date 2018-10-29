const serializeError = require('serialize-error');

const Datastore = require('./datastore');
const Pubsub = require('./pubsub');

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

class AirblastController {
	constructor(name, opts) {
		this.name = name;
		this.topic = opts.topic || name;
		this.kind = opts.kind || name;
		this.retries = opts.retries || DEFAULT_RETRY;
		this.maxProcessingTime = opts.masProcessingTime || 5;

		this.datastore = new Datastore(opts.datastore || {});
		this.pubsub = new Pubsub(opts.pubsub || {});
	}

	async post(req) {
		const data = req.body.data;

		this.validate(data);
		this.beforeSave({ data });

		// Save to datastore
		const key = this.datastore.save(this.kind, data, req.body);

		// If not delayed, run immediately
		if (!req.body.runAt) this.pubsub.publish(this.topic, key);

		// Publish
		this.afterSave({ key, data, pubsubId });

		// return success
		return {
			status: 200,
			body: {
				data,
			}
		};
	}

	async run(input) {
		const pubsubMessage = pubsubDecode(input)

		const record = this.datastore.load(pubsubMessage.key);

		// Avoid repeat processing
		if (record.processedAt) return;

		try {
			this.beforeProcess({ record, data: record.data);

			await this.datastore.update(pubsubMessage.key, {
				lastAttempt: new Date();
			});

			this.process({ record, data: record.data });
			this.afterProcess({ record, record.data });

			// update processedAt
			record.processedAt = new Date();
		} catch (e) {
			console.error(e);

			// Save any errors encountered
			record.lastError = JSON.stringify(serializeError(e));
			if (!record.firstError) {
				record.firstError = lastError;
			}
		}

		await datastoreUpdate(pubsubMessage.key, record);
	}

	async retry() {
		const datastore = google.datastore();
		const pubsub = google.pubsub();

		let query = this.datastore.createQuery([this.kind])
			.filter('processedAt', null)
			.filter('failedAt', null)
			.filter('nextAttempt', '<=', new Date())
			.filter('lastAttempt', '<=', new Date() - this.maxProcessingTime);

		await findAndRetry(query);

		let query = this.datastore.createQuery([this.kind])
			.filter('processedAt', null)
			.filter('failedAt', null)
			.filter('nextAttempt', '<=', new Date())
			.filter('lastAttempt', null)
			.filter('createdAt', '<', new Date() - this.maxProcessingTime);

		await findAndRetry(query);
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
				record.nextAttempt = lastAttempt + interval;
				record.retries += 1;
			} else {
				record.failedAt = record.lastAttempt;
			}

			await this.datastore.update(
				record[datastore.KEY],
				_.pick(record, ['nextAttempt', 'retries', 'failedAt'])
			);
		}

		// If the nextAttempt is now (or has passed), queue it
		if ((record.lastAttempt == null) || (record.nextAttempt <= NOW)) {
			await this.pubsub.publish(this.topic, { key: record[datastore.KEY] });
		}
	}
}
