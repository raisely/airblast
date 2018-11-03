const { AirblastController } = require('airblast');

/**
  * This controller will
  * 1. receive data from http post requests (no validation)
  * 2. enqueue that data for processing by the MyTask controller
  */
class MyTask extends AirblastController {
	async process({ data }) {
		// Put data on myTask's job queue
		this.controllers.myTask.enqueue(data);
	}
}

MyTask.options = options;

module.exports = MyTask;
