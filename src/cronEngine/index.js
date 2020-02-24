const { CronJob } = require('cron');
const request = require('request-promise-native');
const package = require('../../package');

let cronTasks = [];

function makeRequest(req) {
	const options = typeof req === 'string' ? { uri: req } : { ...req };
	Object.assign(options, {
		headers: {
			'User-Agent': `Airblast Cron Engine ${package.version}`,
		},
	});
	request(options).catch(console.error);
}

module.exports = {
	start: (jobs) => {
		jobs.forEach((job) => {
			cronTasks.push(new CronJob({
				cronTime: job.schedule,
				onTick: () => makeRequest(job.request),
				timezone: job.timezone,
				start: true,
			}));
		});
	},

	stop: () => {
		cronTasks.forEach(task => task.stop());
		cronTasks = [];
	},
};
