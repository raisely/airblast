// FIXME create generator for this file

// Every 10 minutes
const schedule = '*/10 * * * *';

const crons = [{
	schedule,
	request: 'ChainTaskRetry',
}, {
	schedule,
	request: 'MyTaskRetry',
}];

module.exports = crons;
