const { AirblastController } = require('airblast');

const options = {
	topic: 'customTopic',
};

class MyTask extends AirblastController {
	async process({ data }) {
		// Put data on myTask's job queue
		this.controllers.myTask.enqueue(data);
	}
}

MyTask.options = options;

module.exports = MyTask;
