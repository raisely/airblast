const fs = require('fs');
const path = require('path');

const _ = require('lodash');

function isValidJsFile(filename) {
	return path.extname(filename) === '.js' && (filename !== 'index.js');
}

// make this a helper
/**
  * @param {object} options global options for all controllers
  * @param {object} controllerOptions Map from controller names to individual controller options
  * @returns {AirblastController[]} Array of initialised controllers
  */
function init(dirname, options, controllerOptions = {}) {
	const controllers = {};

	// Load each controller file
	Object.assign({}, ...fs.readdirSync(dirname)
		.filter(isValidJsFile)
		.forEach((file) => {
			// eslint-disable-next-line global-require, import/no-dynamic-require
			const Controller = require(path.join(dirname, file));

			const opt = Object.assign({}, options, controllerOptions[Controller.name]);

			const controller = new Controller(opt);

			controllers[_.camelCase(controller.name)] = controller;
			controller.controllers = controllers;
			return controller;
		}));

	return controllers;
}

module.exports = init;
