const Airblast = require('Airblast');

const Controllers = require('./controllers');

const config = {
	datastore: {},
	pubsub: {},
	// Authenticate can also be a function
	authenticate: 'SECRET_TOKEN',
	log: console.log,
};

const controllers = Controllers(config);

module.exports = Airblast.routes(controllers);

// Deploy functions would be
const deploy = [
	`gcloud functions deploy ${controller.name} --trigger-http`,
	`gcloud functions deploy ${controller.name}Retry --trigger-http`,
	`gcloud functions deploy ${controller.name}Process --trigger-resource ${controller.topic} --trigger-event google.pubsub.topic.publish`,
];
