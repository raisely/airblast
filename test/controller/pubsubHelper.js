
/**
  * Helper to manage subscribing to a topic and collecting messages
  * will return a promise that resolves to {messageData, promise, subscription }
  * once the subscription is ready (ie when pubsub.createSubscription() resolves)
  *
  * @async
  * @param {@google-cloud/pubsub} pubsub A pubsub instance this can use
  * @param {string} topic to subscribe to
  * @param {integer} resolveAfter Number of messages to resolve promise after
  * @returns {Promise} That resolves to { messages, rawMessages, promise, subscription }
  * @example
  * { promise, messageData, rawMessages, subscription } = await subscribe(pubsub, 'Events', 3);
  *
  * // Will resolve after 3 messages have been sent to the topic
  * await promise;
  * // The 3 messages straight off pubsub
  * console.log(rawMessages);
  * // The array of JSON.parse(Buffer.from(message.data).toStrong()) of the
  * // message as an object
  * console.log(messageData);
  * // Clean up after tests
  * await subscription.delete();
  */
function subscribe(pubsub, topic, resolveAfter) {
	const messageData = [];
	const rawMessages = [];
	let subscription;
	let onMessage;

	// Create a promise that resolves when all deliveries have been
	// sent to pubsub
	const promise = new Promise((resolve) => {
		function saveMessage(message) {
			rawMessages.push(message);
			let data = Buffer.from(message.data, 'base64').toString();
			data = JSON.parse(data);
			messageData.push(data);

			if (rawMessages.length >= resolveAfter) resolve(messageData);
		}
		onMessage = saveMessage;
	});

	return pubsub.createSubscription(topic, 'testSub')
		.then((result) => {
			// eslint-disable-next-line prefer-destructuring
			subscription = result[0];
			subscription.on('message', onMessage);

			return {
				messageData,
				promise,
				rawMessages,
				subscription
			};
		});
}

module.exports = {
	subscribe
};
