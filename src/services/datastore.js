const Datastore = require('@google-cloud/datastore');
const promiseRetry = require('promise-retry');
const uuidv1 = require('uuid/v1');

const CacheableService = require('./cacheableService');

// Datastore config keys used to build unique cache key
const configUniqueKeys = ['projectId', 'servicePath', 'namespace', 'email', 'apiEndpoint', 'keyFilename'];

class DatastoreWrapper extends CacheableService {
	/**
	  * Datastore wrapper, handles caching so only one instance is created
	  * per process
	  */
	constructor(config) {
		super(config, {
			configUniqueKeys,
			serviceName: 'Datastore',
			Service: Datastore,
		});
	}

	/**
	  * @param key Fetch a record from datastore by key
	  * Parses json in the data attribute
	  * @return {object}
	  */
	async get(key) {
		const result = await this.getDatastore().get(key);

		const [record] = result;

		if (!record) {
			throw new Error(`No record found for key ${key}`);
		}

		record.data = JSON.parse(record.data);

		return record;
	}

	/**
	  * @param key Key of the document to update
	  * @param {object} document Document to update
	  * Performs up to 3 retries in case of network error
	  */
	async update(key, document) {
		return promiseRetry(retry => this.getDatastore().update({
			key,
			data: document,
			excludeFromIndexes: ['data', 'firstError', 'lastError'],
		}).catch(retry), {
			retries: 3,
		});
	}

	/**
	  * Nests the data in a record containig meta data or retries
	  * and saves the record
	  * @param {string} name The name of the entity to save
	  * @param {object} data The data to store on the record
	  * @param {object} body The body containing runAt property
	  * @return {object} OF the form { key, record } the record and the key it was saved by
	  */
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

	/**
	  * Pass through to datastore.createQuery
	  * @param {object} key
	  * @returns {object} Query
	  */
	createQuery(key) {
		return this.getDatastore().createQuery(key);
	}

	/**
	  * Pass through to datastore.runQuery
	  * @param {object} query
	  */
	async runQuery(query) {
		return this.getDatastore().runQuery(query);
	}
}

module.exports = DatastoreWrapper;
