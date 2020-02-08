const emulators = require('../emulators');

const queues = ['Empty', 'WithHooks'];

before(function runBefore() {
	this.timeout(20000);
	return emulators.start(queues);
});

after(() => emulators.stop());
