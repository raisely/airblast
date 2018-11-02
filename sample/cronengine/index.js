const cronEngine = require('airblast/cronEngine');
const controllers = require('../controllers');

// Every 10 minutes
const schedule = '*/10 * * * *';

const crons = controllers.map(c => ({
	schedule,
	request: `${c.name}-retry`,
}));

cronEngine.start(crons);
