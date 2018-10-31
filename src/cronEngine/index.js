const { CronJob } = require('cron');
const request = require('request-promise-native');

let cronTasks = [];

function makeRequest(req) {
	request(req).catch(console.error);
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
