const PubSub = require('@google-cloud/pubsub');
const CacheableService = require('./cacheableService');

// Datastore config keys used to build unique cache key
const configUniqueKeys = ['projectId', 'email', 'apiEndpoint', 'keyFilename'];

class PubsubWrapper extends CacheableService {
	constructor(config) {
		super(config, {
			configUniqueKeys,
			serviceName: 'Pubsub',
			Service: PubSub,
		});
	}

	async publish(name, key) {
		const topic = await this.getPubsub().topic(name);

		console.log('publishing event', (await topic.exists()));

		// route the event to the receiver queues
		const message = await topic.publisher()
			.publish(Buffer.from(JSON.stringify({ key })));

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
