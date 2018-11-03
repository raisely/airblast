const { AirblastController } = require('airblast');

const options = {
	topic: 'customTopic',
	// Turn on logging only for this controller
	log: console.log,
};

/**
  * This controller will
  * 1. Receive data over http post, and validate that it contains an `id` attribute
  * (The http post will fail with status 400 if data.id is missing)
  * 2. Log the data contents to the console during background processing
  */
class MyTask extends AirblastController {
	// eslint-disable-next-line class-methods-use-this
	async validate({ data }) {
		if (!data.id) {
			throw new this.AppError(400, 'invalid', 'The data should have an id!');
		}
	}

	async process({ data }) {
		console.log(`(${this.name}) Processing data: `, data);
	}
}

MyTask.options = options;

module.exports = MyTask;
