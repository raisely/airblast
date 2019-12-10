const DatastoreEmulator = require('google-datastore-emulator');
const PubSubEmulator = require('google-pubsub-emulator');

const queues = ['Empty', 'WithHooks'];

const emulators = [];

process.env.GCLOUD_PROJECT = 'relay-test';

let haveWarned = false;

before(function before() {
	if (!haveWarned) {
		/* eslint-disable no-console */
		console.log('Launching datastore & pubsub emulators...');
		console.log("If this times out, it may because they're not installed");
		console.log("if you're getting a timeout, be sure to run");
		console.log('   gcloud components install pubsub-emulator');
		console.log('   gcloud components install cloud-datastore-emulator');
		console.log('');
		haveWarned = true;
	}
	/* eslint-enable no-console */
	this.timeout(20000);
	emulators.push(new DatastoreEmulator({ debug: false }));
	emulators.push(new PubSubEmulator({
		clean: true,
		dataDir: './tmp/pubsub',
		topics: queues,
		debug: false,
	}));
	return Promise.all(emulators.map(e => e.start()));
});

after(() => Promise.all(emulators.map(e => e.stop())));
