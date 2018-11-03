const _ = require('lodash');

// Cache datastore connections (in line with google cloud best practices)
const serviceCache = {};

/**
  * Cacheable service
  * Provides caching for services so that connections only need be established
  * once, as per cloud function best practices:
  * https://cloud.google.com/functions/docs/bestpractices/networking
  *
  * Subclasses supply the class to instantiate and keys to use for caching the service
  *
  * Subclasses and other code that uses the service call getService() to get or created
  * an instance of the Service to interact with
  *
  * Instances will have a convenience method called get<serviceName> to access the
  * service instance
  *
  * @example
  * class DatastoreWrapper extends CacheableService {
  *		constructor(config) {
  *			super(config, { serviceName: 'Datastore', service: Datastore });
  *		}
  *		get(key) {
  *			return this.getDatastore().get(key);
  *		}
  *	}
  */
class CacheableService {
	/**
	  * @param {object} config Configuration to pass to service constructor
	  * @param {object} cacheConfig Configuration for this subclass of CachableService
	  * @param {string} cacheConfig.serviceName A name to give the service
	  * @param {string[]} cacheConfig.configUniqueKeys Keys of `config` that can be serialized
	  * to strings and combined to make a unique cache key
	  * @param {Class[]} cacheConfig.Service The service that this class should instantiate
	  *
	  * Instances will have a convenience method get<cacheConfig.serviceName> that is
	  * an alias of getService()
	  */
	constructor(config = {}, cacheConfig) {
		this.config = config;

		this.service = null;

		Object.assign(this, _.pick(cacheConfig, ['Service', 'serviceName', 'configUniqueKeys']));

		this[`get${this.serviceName}`] = this.getService;
	}

	/**
	  * Return an instance of the service represented by the config of this instance
	  * Will create the service instance if this is the first call to getService
	  * @return {this.Service} Instance of the service
	  * @alias get<this.serviceName>
	  */
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
