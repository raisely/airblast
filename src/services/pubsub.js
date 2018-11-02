const PubSub = require('@google-cloud/pubsub');
const CacheableService = require('./cacheableService');

// Pubsub config keys used to build unique cache key
const configUniqueKeys = ['projectId', 'email', 'apiEndpoint', 'keyFilename'];

class PubsubWrapper extends CacheableService {
	constructor(config, autoCreateTopic) {
		super(config, {
			configUniqueKeys,
			serviceName: 'Pubsub',
			Service: PubSub,
		});

		this.autoCreateTopic = autoCreateTopic;
	}

	async createTopic(topic) {
		return this.getPubsub().createTopic(topic);
	}

	async publish(topic, key, name) {
		const topicObj = await this.getPubsub().topic(topic);

		const exists = await topicObj.exists();

		if (!exists) {
			if (this.autoCreateTopic) {
				await this.getPubsub().createTopic(topic);
			} else {
				throw new Error(`Topic ${topic} does not exist and auto create is disabled.`);
			}
		}

		// route the event to the receiver queues
		const message = await topicObj.publisher()
			.publish(Buffer.from(JSON.stringify({ name, key })));

		return message;
	}

	static async decodeMessage(input) {
		// check we have the data
		const message = input.data;
		if (!message.data) throw new Error('No message.data');

		// parse the message
		let data = Buffer.from(message.data, 'base64').toString();
		data = JSON.parse(data);

		return data;
	}
}

module.exports = PubsubWrapper;
