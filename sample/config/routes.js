const Airblast = require('airblast');

const Controllers = require('../controllers');

const config = {
	datastore: {
		// Datastore config
	},
	pubsub: {
		// pubsub config
	},
	// Authenticate can also be a function
	authenticate: process.env.AUTH_TOKEN,
	// eslint-disable-next-line no-console
	log: console.log,
};

const controllers = Controllers(config);

module.exports = Airblast.routes(controllers);
