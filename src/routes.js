function exportRoutes(controllers) {
	const routes = {};

	controllers.forEach((controller) => {
		routes[controller.name] = controller.http;
		routes[`${controller.name}Retry`] = controller.httpRetry;
		routes[`${controller.name}Process`] = controller.pubsubMessage;
	});

	return routes;
}

module.exports = exportRoutes;
