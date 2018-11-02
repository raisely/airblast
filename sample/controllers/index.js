const fs = require('fs');
const path = require('path');

function isValidJsFile(filename) {
	return path.extname(filename) === '.js' && (filename !== 'index.js');
}

function init(options) {
	// Load each controller file
	const controllers = Object.assign({}, ...fs.readdirSync(__dirname)
		.filter(isValidJsFile)
		.map((file) => {
			// eslint-disable-next-line global-require, import/no-dynamic-require
			const Controller = require(path.join(__dirname, file));

			return new Controller(options);
		}));

	return controllers;
}

module.exports = init;
