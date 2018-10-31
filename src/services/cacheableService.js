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
			const cacheKey = this.configUniqueKeys.reduce((key, cacheStr) => `${cacheStr},${this.config[key]}`, this.serviceName);

			if (!serviceCache[cacheKey]) {
				serviceCache[cacheKey] = new this.ServiceClass(this.config);
			}

			this.service = serviceCache[cacheKey];
		}

		return this.service;
	}
}

module.exports = CacheableService;
