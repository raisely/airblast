const _ = require('lodash');

// Cache datastore connections (in line with google cloud best practices)
const serviceCache = {};

class CacheableService {
	constructor(config = {}, cacheConfig) {
		this.config = config;

		this.service = null;

		Object.assign(this, _.pick(cacheConfig, ['Service', 'serviceName', 'configUniqueKeys']));

		this[`get${this.serviceName}`] = this.getService;
	}

	getService() {
		if (!this.service) {
			const cacheKey = [this.serviceName].concat(this.configUniqueKeys
				.map(key => this.config[key])).join(',');

			if (!serviceCache[cacheKey]) {
				serviceCache[cacheKey] = new this.Service(this.config);
			}

			this.service = serviceCache[cacheKey];
		}

		return this.service;
	}
}

module.exports = CacheableService;
