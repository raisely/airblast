const childProcess = require('child_process');
const readline = require('readline');
const _ = require('lodash');

const routes = require('./config/routes');

const gcloud = require('./config/gcloud');

const GOOGLE_DEFAULTS = {
	memory: '128MB',
	runtime: 'nodejs8',
};

const googleConfig = Object.assign(GOOGLE_DEFAULTS, gcloud);

const functionDeployArgs = _.flatten(_.map(googleConfig, (val, key) =>
	[`--${_.kebabCase(key)}`, val]));

module.exports = (grunt) => {
	grunt.registerMultiTask('airblast', 'Deploy cloud functions', function airblast() {
		if (this.target !== 'deploy') {
			throw new Error(`Unknown target ${this.target}`);
		}

		const done = this.async();

		const promises = [deployRoute(routes[0])];
		// const promises = routes.forEach(deployRoute);

		console.log('May take up to two minutes ...');

		Promise.all(promises).then(() => done()).catch(done);
	});

	grunt.initConfig({
		airblast: {
			deploy: {},
		},
	});
};

async function deployRoute(route) {
	const command = 'gcloud';
	const args = [];
	let description;

	if (route.type === 'http') {
		args.push('alpha', 'functions', 'deploy', route.path);
		args.push(...functionDeployArgs);
		args.push('--trigger-http');
		description = `HTTP function ${route.path}`;
	} else if (route.type === 'pubsub') {
		args.push('alpha', 'functions', 'deploy', route.path, '--trigger-resource', route.topic);
		args.push(...functionDeployArgs);
		args.push('--trigger-event', 'google.pubsub.topic.publish');
		description = `pubsub function ${route.path} on topic ${route.topic}`;
	} else {
		throw new Error(`Unknown route type ${route.type}`);
	}

	console.log(`Deploying ${description}`);

	try {
		await spawnChild(command, args, { env: process.env, shell: true });
	} catch (err) {
		console.log('Deploy command failed:');
		console.log(`  ${command} ${args.join(' ')}`);
		console.log('Output:');
		console.log(err.output.allout);
		throw err;
	}
}

async function spawnChild(command, args, opts) {
	const output = {
		stderr: [],
		stdout: [],
		allout: [],
	};

	const log = (line, type) => {
		output[type].push(line);
		output.allout.push(line);
		console.log(line);
	};

	return new Promise((resolve, reject) => {
		const child = childProcess.spawn(command, args, opts);
		readline.createInterface({
			input: child.stdout,
		}).on('line', line => log(line, 'stdout'));
		readline.createInterface({
			input: child.stderr,
		}).on('line', line => log(line, 'stderr'));
		child.on('exit', (code) => {
			if (code !== 0) {
				const err = new Error(`${command} exited with code ${code}`);
				err.output = output;
				reject(err);
			}
		});
	});
}
