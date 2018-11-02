const Datastore = require('@google-cloud/datastore');
const promiseRetry = require('promise-retry');
const uuidv1 = require('uuid/v1');

const CacheableService = require('./cacheableService');

// Datastore config keys used to build unique cache key
const configUniqueKeys = ['projectId', 'servicePath', 'namespace', 'email', 'apiEndpoint', 'keyFilename'];

class DatastoreWrapper extends CacheableService {
	constructor(config) {
		super(config, {
			configUniqueKeys,
			serviceName: 'Datastore',
			Service: Datastore,
		});
	}

	async get(key) {
		const result = await this.getDatastore().get(key);

		const [record] = result;

		if (!record) {
			throw new Error(`No record found for key ${key}`);
		}

		record.data = JSON.parse(record.data);

		return record;
	}

	async update(key, document) {
		return promiseRetry(retry => this.getDatastore().update({
			key,
			data: document,
			excludeFromIndexes: ['data', 'firstError', 'lastError'],
		}).catch(retry), {
			retries: 3,
		});
	}

	async save(name, data, body = {}) {
		const record = {
			data: JSON.stringify(data),
			createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
			nextAttempt: body.runAt ? new Date(body.runAt) : new Date(),
			processedAt: null,
			failedAt: null,
			retries: 0,
			uuid: uuidv1(),
		};

		// save the event in datastore for backup
		const key = this.getDatastore().key([name]);
		await promiseRetry(retry => this.getDatastore().save({
			key,
			data: record,
			excludeFromIndexes: ['data', 'firstError', 'lastError'],
		}).catch(retry), {
			retries: 3,
		});

		return { key, record };
	}

	createQuery(key) {
		return this.getDatastore().createQuery(key);
	}

	async runQuery(query) {
		return this.getDatastore().runQuery(query);
	}
}

module.exports = DatastoreWrapper;
