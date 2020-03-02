const request = require('request-promise-native');
const Fastify = require('fastify');

const packageJson = require('../../package');

const fastify = Fastify({
	logger: true,
	disableRequestLogging: true,
});

// Health route
fastify.get('/', (req, reply) => {
	reply.send({ name: 'Airblast Cron Engine' });
});
fastify.get('/retry', runRetries);

const health = (req, reply) => {
	reply.send({ status: 'ok' });
};
fastify.get('/_ah/start', health);
fastify.get('/_ah/warmup', health);

async function doRetry(job, req) {
	const options = typeof job === 'string' ? { uri: job } : { ...job };
	Object.assign(options, {
		headers: {
			'User-Agent': `Airblast Cron Retry ${packageJson.version}`,
		},
	});
	return request(options).catch(req.log.error);
}

let allJobs;

async function runRetries(req, reply) {
	req.log.info({
		url: req.raw.url,
		method: req.raw.method,
	});
	await Promise.all(allJobs.map(job => doRetry(job.request, req, reply)));
	reply.send({ status: 'ok' });
}

module.exports = {
	start: async (jobs) => {
		allJobs = jobs;
		const PORT = process.env.PORT || 8080;
		try {
			const address = await fastify.listen(PORT);
			return address;
		} catch (e) {
			console.error(e);
			throw e;
		}
	},

	stop: async () => {
		allJobs = [];
		return fastify.close();
	},
};
