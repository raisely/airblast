const fs = require('fs');
const path = require('path');

const _ = require('lodash');

function isValidJsFile(filename) {
	return path.extname(filename) === '.js' && (filename !== 'index.js');
}

/**
  * Helper to initiaise all controllers in a given directory
  * As a convenience, it will set controllers on each controller to the same
  * value as the return value of the function
  * So controllers can pass jobs to OtherController by
  *		this.controllers.other.enqueue(data);
  *
  * @param {string} dirname Path of the directory containing controller to initialise
  * @param {object} options global options for all controllers
  * @param {object} controllerOptions Map from controller names to individual controller options
  * @returns {object} Object mapping controllers by Controller.name
  */
function init(dirname, options, controllerOptions = {}) {
	const controllers = {};

	// Load each controller file
	Object.assign({}, ...fs.readdirSync(dirname)
		.filter(isValidJsFile)
		.map((file) => {
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
