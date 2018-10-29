const Datastore = require('@google-cloud/datastore');

// Cache datastore connections (in line with google cloud best practices)
const datastores = {};

// Datastore config keys used to build unique cache key
const configUniqueKeys = ['projectId', 'servicePath', 'namespace', 'email', 'apiEndpoint', 'keyFilename'];

class DatastoreWrapper {
	constructor(config = {}) {
		this.config = config;
		this.datastore = null;
	}

	getDatastore() {
		if (!this.datastore) {
			let cacheKey = configUniqueKeys.reduce((key, value) => { value += config[key] }, '');

			if (!datastores[cacheKey]) {
				datastores[cacheKey] = new Datastore(this.config);
			}

			this.datastore = datastores[cacheKey];
		}

		return this.datastore;
	}

	async get(key) {
		const result = await this.getDatastore().get(key);

		const [record] = result;

		if (!record || !record.data) {
			console.log(`(${data.eventKey}) data undefined`, result, key);
		}

		record.data = JSON.parse(record.data);

		return record;
	}

	async update(key, document) {
		doRetries
		return this.getDatastore().update({
			key: data.key,
			data: document,
			excludeFromIndexes: ['data']
		});
	}

	async save(name, data, body = {}) {
		const record = {
			data: JSON.stringify(data),
			createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
			nextAttempt:  body.runAt ? new Date(body.runAt) : new Date(),
			processedAt: null,
			failedAt: null,
			retries: 0,
			uuid: uuidv1(),
		};

		// save the event in datastore for backup
		const key = this.getDatastore().key([name]);
		await forRetries((retry, number) => {
			return this.getDatastore().save({
				key,
				data: record,
				excludeFromIndexes: ['data']
			}).catch(retry);
		}, {
			retries: 3
		});

		return key;
	}

	createQuery(key) {
		return this.getDatastore().createQuery(key);
	}

	async runQuery(query) {
		return this.getDatastore().runQuery(key);
	}
}

module.exports = DatastoreWrapper;
