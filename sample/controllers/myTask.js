const { AirblastController } = require('airblast');

const options = {
	topic: 'customTopic',
	// Turn on logging only for this controller
	log: console.log,
};

class MyTask extends AirblastController {
	// eslint-disable-next-line class-methods-use-this
	async validate({ data }) {
		if (!data.id) {
			throw new Error('The data should have an id!');
		}
	}

	async process({ data }) {
		console.log(`(${this.name}) Processing data: `, data);
	}
}

MyTask.options = options;

module.exports = MyTask;
