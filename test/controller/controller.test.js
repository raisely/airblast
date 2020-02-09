const Datastore = require('@google-cloud/datastore');
const Pubsub = require('@google-cloud/pubsub');
const uuidv1 = require('uuid/v1');

const serializeError = require('serialize-error');
const containSubset = require('chai-subset');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const sinon = require('sinon');
const _ = require('lodash');

const runController = require('../runController');

chai.use(containSubset);
chai.use(chaiAsPromised);
const { expect } = chai;

const TOKEN = 'SECRET_TOKEN!';

require('./specHelper');

const { AirblastController } = require('../../index');
const { subscribe } = require('./pubsubHelper');

class EmptyController extends AirblastController {}
EmptyController.options = {
	authenticate: TOKEN,
	// eslint-disable-next-line no-console
	log: console.log,
	corsHosts: ['cors.host.test'],
};
class WithHooksController extends AirblastController {}
WithHooksController.options = {
	// eslint-disable-next-line no-console
	log: console.log,
};
class CustomAuthController extends AirblastController {}
CustomAuthController.options = {
	log: console.log,
};

const hookNames = ['validate', 'beforeSave', 'afterSave', 'beforeProcess', 'process', 'afterProcess'];

hookNames.forEach((hook) => { WithHooksController.prototype[hook] = _.noop; });

const notNull = Symbol('not null');

describe('AirblastController', () => {
	let pubsub;
	let datastore;

	before(() => {
		datastore = new Datastore();
		pubsub = new Pubsub();
	});

	describe('options', () => {
		let res;
		describe('permitted host', () => {
			before(async () => {
				const controller = new EmptyController();
				const req = {
					method: 'OPTIONS',
					headers: {
						origin: 'https://cors.host.test',
					},
				};
				res = await runController(controller, req);
			});
			it('permits host', () => {
				expect(res.headers['Access-Control-Allow-Origin']).to.eq('https://cors.host.test');
			});
		});
		describe('unpermitted host', () => {
			let controller;
			let req;
			before(() => {
				controller = new EmptyController();
				req = {
					method: 'OPTIONS',
					headers: {
						origin: 'https://unknown.host.test',
					},
				};
			});
			it('throws error', async () => {
				const promise = runController(controller, req);
				await expect(promise).to.be.rejectedWith('Cross origin requests not allowed from this host: unknown.host.test');
			});
		});
	});

	describe('post', () => {
		describe('test response', () => {
			let res;
			let controller;
			let authToken;

			describe('WITH auth string', () => {
				before(() => {
					CustomAuthController.options.authenticate = TOKEN;
					controller = new CustomAuthController();
					controller.validate = () => { throw new Error('validate called on blank request'); };
				});
				describe('WHEN token is present', () => {
					before(async () => {
						const req = createPostReq({}, TOKEN);
						req.throwOnError = false;
						res = await runController(controller, req);
					});
					it('returns 200', () => { expect(res.statusCode).to.eq(200); });
				});
				describe('WHEN token is missing', () => {
					before(async () => {
						const req = createPostReq({}, null);
						req.throwOnError = false;
						res = await runController(controller, req);
					});
					it('returns 301', () => { expect(res.statusCode).to.eq(401); });
				});
			});
			describe('WITH auth function', () => {
				before(() => {
					CustomAuthController.options.authenticate = (token) => {
						authToken = token;
						return true;
					};
					controller = new CustomAuthController();
					controller.validate = () => { throw new Error('validate called on blank request'); };
				});
				describe('WITH bearer auth', () => {
					before(async () => {
						const req = createPostReq({});
						res = await runController(controller, req);
					});
					it('returns 200', () => { expect(res.statusCode).to.eq(200); });
					it('receives the just the token', () => expect(authToken).to.eq(TOKEN));
				});
				describe('WITH simple auth', () => {
					before(async () => {
						authToken = null;
						const req = createPostReq({}, 'something shared-secret');
						res = await runController(controller, req);
					});
					it('returns 200', () => { expect(res.statusCode).to.eq(200); });
					it('receives the full auth header', () => expect(authToken).to.eq('something shared-secret'));
				});
				describe('WITHOUT auth', () => {
					before(async () => {
						authToken = 'not received';
						const req = createPostReq({}, null);
						req.throwOnError = false;
						res = await runController(controller, req);
					});
					it('returns 401', () => { expect(res.statusCode).to.eq(401); });
				});
				describe('WHEN forbidden', () => {
					before(async () => {
						authToken = null;
						const req = createPostReq({});
						// Will fail when token is missing
						CustomAuthController.options.authenticate = async () => false;
						controller = new CustomAuthController();
						req.throwOnError = false;
						res = await runController(controller, req);
					});
					it('returns 401', () => { expect(res.statusCode).to.eq(401); });
				});
				describe('WITH bearer auth string', () => {
					before(async () => {
						const req = createPostReq({});
						CustomAuthController.options.authenticate = TOKEN;
						controller = new CustomAuthController();
						res = await runController(controller, req);
					});
					it('returns 200', () => { expect(res.statusCode).to.eq(200); });
				});
			});
		});
		describe('without hooks', () => {
			const eventData = {
				createdAt: new Date().toISOString(),
				name: 'Amelia Telford',
				message: 'Hi there',
			};
			let res;
			const container = {};
			let subscription;

			before(async () => {
				const req = createPostReq(eventData);
				const controller = new EmptyController();

				const subscriptionDetails = await subscribe(pubsub, 'Empty', 1);
				({ subscription } = subscriptionDetails);

				res = await runController(controller, req);

				const messages = await subscriptionDetails.promise;
				Object.assign(container, { datastore, messages });
			});
			after(() => subscription.delete());

			it('returns 200', () => { expect(res.statusCode).to.eq(200); });

			itSavesAndPublishes(eventData, container);

			it('initialises record metadata', () => {
				const { record } = container;
				expect(record).to.containSubset({
					createdAt: new Date(eventData.createdAt),
					processedAt: null,
					failedAt: null,
					retries: 0,
				});
				expect(record.nextAttempt).to.not.eq(null);
			});
			it('saves data', () => {
				const { record } = container;
				expect(JSON.parse(record.data)).to.deep.eq(eventData);
			});
		});

		describe('with hooks', () => {
			const hooks = {};
			const eventData = {
				format: 'text',
				text: "I'm a lumberjack and I'm ok",
			};

			before(async () => {
				const req = createPostReq(eventData);
				const controller = new WithHooksController();

				['validate', 'beforeSave', 'afterSave']
					.forEach((hook) => { hooks[hook] = sinon.spy(controller, hook); });

				await runController(controller, req);
			});

			itCallsHook(hooks, 'validate', { data: eventData });
			itCallsHook(hooks, 'beforeSave', { data: eventData });
			itCallsHook(hooks, 'afterSave', { data: eventData, key: notNull, pubsubId: notNull });
		});
	});

	describe('enqueue', () => {
		let subscription;
		const payload = {
			all: 'The people in the world',
			stand: true,
			as: 1,
		};
		const container = {};

		before(async () => {
			const subscriptionDetails = await subscribe(pubsub, 'Empty', 1);
			({ subscription } = subscriptionDetails);
			const controller = new EmptyController();

			await controller.enqueue(payload);

			const messages = await subscriptionDetails.promise;
			Object.assign(container, { messages, datastore });
		});
		after(() => subscription.delete());

		itSavesAndPublishes(payload, container);
	});

	describe('pubsubMessage', () => {
		describe('without hooks', () => {
			const container = {};
			const eventData = {
				message: 'i would walk',
				distance: 500,
				unit: 'miles',
			};

			before(async () => {
				const controller = new EmptyController();

				container.recordKey = await setupRecord(datastore, 'Empty', eventData);
				await sendPubsubPayload(controller, container.recordKey, 'Empty');
				container.datastore = datastore;
			});
			itMarksTheRecordProcessed(container);
		});
		describe('with hooks', () => {
			const eventData = {
				condition: 'good day',
				equals: 'sunshine',
			};

			const container = {};
			const hooks = {};
			const payload = { record: { data: eventData }, data: eventData };

			before(async () => {
				const controller = new WithHooksController();

				['beforeProcess', 'process', 'afterProcess']
					.forEach((hook) => { hooks[hook] = sinon.spy(controller, hook); });

				container.recordKey = await setupRecord(datastore, 'WithHooks', eventData);
				payload.key = container.recordKey;
				await sendPubsubPayload(controller, container.recordKey, 'WithHooks');
				container.datastore = datastore;
			});

			itCallsHook(hooks, 'beforeProcess', payload);
			itCallsHook(hooks, 'process', payload);
			itCallsHook(hooks, 'afterProcess', payload);

			itMarksTheRecordProcessed(container);
		});
		describe('on failure', () => {
			const firstError = new Error('First failure');
			let controller;

			before(() => {
				controller = new WithHooksController({ log: false });
			});

			describe('first failure', () => {
				let record;
				let recordKey;
				const eventData = {
					beans: 'green',
				};

				before(async () => {
					controller.process = () => { throw firstError; };
					recordKey = await setupRecord(datastore, 'WithHooks', eventData);
					await sendPubsubPayload(controller, recordKey, 'WithHooks');
				});

				it('should set lastError', async () => {
					[record] = await datastore.get(recordKey);
					expect(record.lastError).to.eq(JSON.stringify(serializeError(firstError)));
				});
				it('should set firstError', () => {
					expect(record.firstError).to.eq(JSON.stringify(serializeError(firstError)));
				});
			});
			describe('second failure', () => {
				const secondError = new Error('Second failure');
				let record;
				let recordKey;
				const eventData = { message: 'Doooooooooomed!' };

				before(async () => {
					controller.process = () => { throw secondError; };
					recordKey = await setupRecord(datastore, 'WithHooks', eventData, {
						firstError: JSON.stringify(serializeError(firstError)),
						lastError: JSON.stringify(serializeError(firstError)),
					});
					await sendPubsubPayload(controller, recordKey, 'WithHooks');
				});

				it('should set lastError', async () => {
					[record] = await datastore.get(recordKey);
					expect(record.lastError).to.eq(JSON.stringify(serializeError(secondError)));
				});
				it('should leave firstError unchanged', () => {
					expect(record.firstError).to.eq(JSON.stringify(serializeError(firstError)));
				});
			});
		});
	});

	describe('retry', () => {
		const eventData = {
			do: 'the time warp',
			frequency: 'again',
		};
		let messages;
		let subscription;
		let controller;
		// To set something to ten minutes ago, subtract 10 minutes and 1 ms so
		// it definitely passes the condition
		const TEN_MINUTES = (10 * 60 * 1000) + 1;

		before(() => {
			controller = new EmptyController();
		});

		describe('WHEN record is just created', () => {
			const container = {};

			before(async () => {
				container.recordKey = await setupRecord(datastore, 'Empty', eventData, {
				});

				const subscriptionDetails = await subscribe(pubsub, 'Empty', 0);
				({ subscription, messages } = subscriptionDetails);
				Object.assign(container, { datastore, messages });
				await runController(controller, createRetryReq({}));
			});
			after(() => Promise.all([
				subscription.delete(),
				datastore.delete(container.recordKey),
			]));

			itDoesNotPublish(container);
			itDoesNotChangeTheRecord(container);
		});

		describe('WHEN record never attempted', () => {
			const container = {};

			before(async () => {
				container.recordKey = await setupRecord(datastore, 'Empty', eventData, {
					createdAt: new Date(new Date() - TEN_MINUTES),
				});

				const subscriptionDetails = await subscribe(pubsub, 'Empty', 1);
				let promise;
				// eslint-disable-next-line prefer-const
				({ subscription, messages, promise } = subscriptionDetails);
				Object.assign(container, { datastore, messages });

				await runController(controller, createRetryReq({}));
				await promise;
			});
			after(() => Promise.all([
				subscription.delete(),
				datastore.delete(container.recordKey),
			]));

			itPublishes(container);
			itDoesNotChangeTheRecord(container);
		});

		describe('WHEN record has just failed', () => {
			const container = {};
			before(async () => {
				container.recordKey = await setupRecord(datastore, 'Empty', eventData, {
					createdAt: new Date(new Date() - (TEN_MINUTES * 2)),
					lastAttempt: new Date(new Date() - TEN_MINUTES),
					nextAttempt: new Date(new Date() - TEN_MINUTES - 5),
				});

				const subscriptionDetails = await subscribe(pubsub, 'Empty', 0);
				({ subscription, messages } = subscriptionDetails);
				Object.assign(container, { datastore, messages });

				await runController(controller, createRetryReq({}));
			});
			after(() => Promise.all([
				subscription.delete(),
				datastore.delete(container.recordKey),
			]));

			it('should set nextAttempt', async () => {
				const { recordKey } = container;
				const [record] = await datastore.get(recordKey);
				expect(record.nextAttempt > record.lastAttempt, 'nextAttempt > lastAttempt');
				expect(record.processedAt, `processedAt should be null (${record.processedAt})`).to.eq(null);
				container.record = record;
			});
			it('should increment retries', () => {
				expect(container.record.retries).to.eq(1);
			});
			itDoesNotPublish(container);
		});

		describe('WHEN record is at nextAttempt', () => {
			const container = {};
			const recordMeta = {
				createdAt: new Date(new Date() - (TEN_MINUTES * 3)),
				lastAttempt: new Date(new Date() - (TEN_MINUTES * 3)),
				nextAttempt: new Date(new Date()),
				retries: 1,
			};
			before(async () => {
				container.recordKey = await setupRecord(datastore, 'Empty', eventData, recordMeta);

				const subscriptionDetails = await subscribe(pubsub, 'Empty', 1);
				let promise;
				// eslint-disable-next-line prefer-const
				({ subscription, messages, promise } = subscriptionDetails);
				Object.assign(container, { datastore, messages });

				await runController(controller, createRetryReq({}));
				await promise;
			});
			after(() => Promise.all([
				subscription.delete(),
				datastore.delete(container.recordKey),
			]));

			itPublishes(container);
			it('should not change the record', async () => {
				const [record] = await container.datastore.get(container.recordKey);
				expect(record).to.containSubset(recordMeta);
			});
		});

		describe('WHEN record has exceeded retries', () => {
			const container = {};
			before(async () => {
				container.recordKey = await setupRecord(datastore, 'Empty', eventData, {
					retries: 8,
					lastAttempt: new Date(new Date() - TEN_MINUTES),
					nextAttempt: new Date(new Date() - TEN_MINUTES),
				});

				const subscriptionDetails = await subscribe(pubsub, 'Empty', 0);
				({ subscription, messages } = subscriptionDetails);
				Object.assign(container, { datastore, messages });

				await runController(controller, createRetryReq({}));
			});
			after(() => Promise.all([
				subscription.delete(),
				datastore.delete(container.recordKey),
			]));

			itDoesNotPublish(container);
			it('should mark the record failed', async () => {
				const [record] = await container.datastore.get(container.recordKey);
				expect(record.failedAt).to.not.eq(null);
			});
		});
	});
});

function itMarksTheRecordProcessed(container) {
	it('marks the record processed', async () => {
		const { datastore, recordKey } = container;
		const records = await datastore.get(recordKey);
		expect(records).to.have.length(1);
		const [record] = records;
		expect(record.lastAttempt, 'lastAttempt').to.not.eq(null);
		expect(record.processedAt, 'processedAt').to.not.eq(null);
	});
}

function createRetryReq(body, auth) {
	const req = createPostReq(body, auth);
	req.function = 'httpRetry';
	return req;
}

function createPostReq(body, auth) {
	let authorization = auth;
	if (!auth && auth !== null) authorization = `Bearer ${TOKEN}`;
	return {
		method: 'POST',
		headers: {
			authorization,
		},
		body,
		mockEnqueue: false,
	};
}

function itDoesNotChangeTheRecord(container) {
	it('should not change the record', async () => {
		const [record] = await container.datastore.get(container.recordKey);
		expect(record).to.containSubset({
			nextAttempt: null,
			retries: 0,
		});
	});
}

function itCallsHook(spies, name, expectedOpts) {
	it(`calls ${name}`, () => {
		expect(spies[name].called).to.eq(true);
		const opts = spies[name].getCall(0).args[0];
		expect(opts).to.have.keys(Object.keys(expectedOpts));

		Object.keys(expectedOpts).forEach((key) => {
			if ((expectedOpts[key]) === notNull) {
				// eslint-disable-next-line no-unused-expressions
				expect(opts[key]).to.not.be.null;
			} else {
				expect(opts[key]).to.containSubset(expectedOpts[key]);
			}
		});
	});
}

function itSavesAndPublishes(eventData, recordContainer) {
	itPublishes(recordContainer);
	it('saves payload to datastore', async () => {
		const { recordKey, datastore } = recordContainer;
		if (!recordKey) throw new Error('recordKey is null. (maybe past step failed)');

		const results = await datastore.get(recordKey);
		const [record] = results;
		const data = JSON.parse(record.data);
		expect(data).to.deep.equal(eventData);

		recordContainer.record = record;
	});
}

function itPublishes(container) {
	it('queues payload in pubsub', () => {
		expect(container.messages).to.have.length(1);
		expect(container.messages[0]).to.have.keys(['key', 'name']);
		if (container.recordKey) {
			expect(container.messages[0].key).to.containSubset(container.recordKey);
		} else {
			container.recordKey = container.messages[0].key;
		}
	});
}

function itDoesNotPublish(container) {
	it('should not enqueue the record', async () => {
		// Give time for pubsub to publish something if its there
		await asyncTimeout(500);
		expect(container.messages).to.have.length(0);
	});
}

async function setupRecord(datastore, name, payload, defaults) {
	const record = Object.assign({
		data: JSON.stringify(payload),
		createdAt: new Date(),
		nextAttempt: null,
		processedAt: null,
		failedAt: null,
		retries: 0,
		uuid: uuidv1(),
	}, defaults);

	const recordKey = datastore.key([name]);
	await datastore.save({
		key: recordKey,
		data: record,
		excludeFromIndexes: ['data', 'firstError', 'lastError'],
	});

	return recordKey;
}

async function sendPubsubPayload(controller, recordKey, name) {
	const pubsubPayload = {
		data: Buffer.from(JSON.stringify({
			key: recordKey,
			name,
		})),
	};

	// Function is called without context in cloud function
	// ensure it can handle it
	const fn = controller.pubsubMessage;

	return fn(pubsubPayload);
}

async function asyncTimeout(time) {
	return new Promise(resolve => setTimeout(resolve, time));
}
