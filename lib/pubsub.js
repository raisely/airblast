const PubSub = require('@google-cloud/pubsub');

// Cache datastore connections (in line with google cloud best practices)
const pubsubs = {};

// Datastore config keys used to build unique cache key
const configUniqueKeys = ['projectId', 'email', 'apiEndpoint', 'keyFilename'];

class PubsubWrapper {
	constructor(config = {}) {
		this.config = config;
		this.pubsub = null;
	}

	getPubsub() {
		if (!this.pubsub) {
			let cacheKey = configUniqueKeys.reduce((key, value) => { value += config[key] }, '');

			if (!pubsubs[cacheKey]) {
				pubsubs[cacheKey] = new PubSub(this.config);
			}

			this.pubsub = pubsubs[cacheKey];
		}

		return this.pubsub;
	}

	async publish(name, key) {
		const topic = await this.getPubsub().topic(name);

		// eslint-disable-next-line no-console
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
