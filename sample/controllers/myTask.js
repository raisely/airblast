const { AirblastController } = require('airblast');

class MyTask extends AirblastController {
	async process(data) {
		console.log('Processing data: ', data);
	}
}
