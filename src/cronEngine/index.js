const request = require('request-promise-native');
const Fastify = require('fastify');

const packageJson = require('../../package');

const fastify = Fastify({
	logger: true,
});

// Health route
fastify.get('/', (req, reply) => {
	reply.send({ name: 'Airblast Cron Engine' });
});
fastify.get('/retry', runRetries);


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
	await Promise.all(allJobs.map(job => doRetry(job.request, req, reply)));
	reply.send({ status: 'ok' });
}

module.exports = {
	start: async (jobs) => {
		allJobs = jobs;
		const PORT = process.env.PORT || 8080;
		try {
			const address = await fastify.listen(PORT);
			fastify.log.info(`server listening on ${address}`);
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
