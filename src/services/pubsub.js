const PubSub = require('@google-cloud/pubsub');
const CacheableService = require('./cacheableService');

// Pubsub config keys used to build unique cache key
const configUniqueKeys = ['projectId', 'email', 'apiEndpoint', 'keyFilename'];

/**
  * Wrapper for pubsub instance to ensure single instantiation per process
  * @example
  * const pubsub = PubsubWrapper(config);
  * await pubsub.publish('my_topic', key, 'my_entity_name')
  */
class PubsubWrapper extends CacheableService {
	/**
	  * Intantiate a wrapper for Pubsub
	  * @param {object} config Pubsub configuration
	  */
	constructor(config) {
		super(config, {
			configUniqueKeys,
			serviceName: 'Pubsub',
			Service: PubSub,
		});
	}

	/**
	  * Create a topic
	  * @param {string} topic
	  */
	async createTopic(topic) {
		return this.getPubsub().createTopic(topic);
	}

	/**
	  * @param {string} topic Topic to publish to
	  * @param {object} key key to save on message
	  * @param {string} name Name of entity that key represents
	  * @return {object} The message published
	  */
	async publish(topic, key, name) {
		const topicObj = await this.getPubsub().topic(topic);

		const [exists] = await topicObj.exists();

		if (!exists) {
			throw new Error(`Topic ${topic} does not exist`);
		}

		// route the event to the receiver queues
		const message = await topicObj.publisher()
			.publish(Buffer.from(JSON.stringify({ name, key })));

		return message;
	}

	/**
	  * Decode a message that's received by a subscriber
	  * Deserialises buffer and parses the JSON
	  * @param {StringBuffer} input The input message
	  * @return {object} The decoded message
	  */
	static decodeMessage(input) {
		// check we have the data
		const message = input.data;

		if (!message) throw new Error('No input.data');

		// parse the message
		let data = Buffer.from(message, 'base64').toString();
		data = JSON.parse(data);

		return data;
	}
}

module.exports = PubsubWrapper;
