/**
  * Helper for generating routes to export to google cloud functions
  * @param {object} controllers map of controllers (as returned by init)
  * @returns {object} Suitable for assigning to module.exports in server entry point
  */
function exportRoutes(controllers) {
	// const defaults = { http: true, retry: true, pubsub: true };

	const routes = [];

	Object.keys(controllers).forEach((name) => {
		const controller = controllers[name];

		routes.push({
			type: 'http',
			fn: controller.http,
			path: name,
		}, {
			type: 'http',
			fn: controller.httpRetry,
			path: `${name}Retry`,
		}, {
			type: 'pubsub',
			fn: controller.pubsubMessage,
			path: `${name}Process`,
			topic: controller.topic,
		});
	});

	return routes;
}

module.exports = exportRoutes;
