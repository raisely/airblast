const MockResponse = require('./utils/mockResponse');

/**
 * Helper to execute controller in test environment
 * @param {Controller} controller The controller to execute
 * @param {object} options Options for creating the request
 * @param {object} options.body The body to pass to the controller
 * @param {object} options.headers The headers to pass to the controller
 * @param {string} options.method Request method (Default: POST)
 * @param {string} options.function The controller function to execute (Default: http)
 * @param {boolean} throwOnError Will throw an error if the controller status is not 200 (Default: true)
 */
async function runRequest(controller, options) {
	const req = Object.assign({
		method: 'POST',
		throwOnError: true,
		function: 'http',
		mockEnqueue: true,
		headers: {},
	}, options);

	const res = new MockResponse();
	const fn = controller[req.function];

	if (req.mockEnqueue) {
		controller._oldEnqueue = controller.enqueue;
		controller.enqueue = async (data) => {
			const key = 'mock_datastore_key';
			const pubsubId = 'mock_pubsub_id';
			await controller.hook('beforeSave', { data });
			await controller.hook('afterSave', { key, data, pubsubId });
			return pubsubId;
		};
	}

	await fn(req, res);

	if (req.mockEnqeueue) controller.enqueue = controller._oldEnqueue;

	if (req.throwOnError && (res.statusCode !== 200)) {
		console.error(res.body);
		throw new Error(res.body.errors[0].message);
	}
	return res;
}

module.exports = runRequest;
