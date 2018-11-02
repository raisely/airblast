const Datastore = require('@google-cloud/datastore');
const Pubsub = require('@google-cloud/pubsub');
const uuidv1 = require('uuid/v1');

const serializeError = require('serialize-error');
const containSubset = require('chai-subset');
const chai = require('chai');
const sinon = require('sinon');
const _ = require('lodash');

chai.use(containSubset);
const { expect } = chai;

const TOKEN = 'SECRET TOKEN!';

require('./specHelper');

const { AirblastController } = require('../../index');
const MockResponse = require('../utils/mockResponse');
const { subscribe } = require('./pubsubHelper');

class EmptyController extends AirblastController {}
EmptyController.options = {
	authorization: TOKEN,
	// eslint-disable-next-line no-console
	log: console.log,
};
class WithHooksController extends AirblastController {}
WithHooksController.options = {
	// eslint-disable-next-line no-console
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

	describe('post', () => {
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
				await pubsub.createTopic('Empty');

				const req = createPostReq(eventData);
				const controller = new EmptyController();

				const subscriptionDetails = await subscribe(pubsub, 'Empty', 1);
				({ subscription } = subscriptionDetails);

				res = await runRequest(controller.http, req);

				const messages = await subscriptionDetails.promise;
				Object.assign(container, { datastore, messages });
			});
			after(() => subscription.delete());

			it('returns 200', () => {
				expect(res.statusCode).to.eq(200);
			});

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

		describe.only('with hooks', () => {
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

				await runRequest(controller.http, req);
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
					.forEach((hook) => { sinon.spy(controller, hook); });

				container.recordKey = await setupRecord(datastore, 'WithHooks', eventData);
				await sendPubsubPayload(controller, container.recordKey, 'Empty');
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
				controller = new WithHooksController();
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
					await sendPubsubPayload(controller, recordKey, 'Empty');
				});

				it('should set lastError', async () => {
					[record] = await datastore.get(recordKey);
					expect(record.lastError).to.deep.eq(serializeError(firstError));
				});
				it('should set firstError', () => {
					expect(record.firstError).to.deep.eq(serializeError(firstError));
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
						firstError, lastError: firstError,
					});
					await sendPubsubPayload(controller, recordKey, 'Empty');
				});

				it('should set lastError', async () => {
					[record] = await datastore.get(recordKey);
					expect(record.lastError).to.deep.eq(serializeError(secondError));
				});
				it('should leave firstError unchanged', () => {
					expect(record.firstError).to.deep.eq(serializeError(firstError));
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

				const subscriptionDetails = await subscribe(pubsub, 'Empty', 1);
				({ subscription, messages } = subscriptionDetails);
				container.messages = messages;
				await runRequest(controller, 'httpRetry', createPostReq({}));
			});
			after(() => subscription.delete());

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
				({ subscription, messages } = subscriptionDetails);
				container.messages = messages;

				await runRequest(controller, 'httpRetry', createPostReq({}));
			});
			after(() => subscription.delete());

			itPublishes(container);
			itDoesNotChangeTheRecord(container);
		});

		describe('WHEN record has just failed', () => {
			const container = {};
			before(async () => {
				container.recordKey = await setupRecord(datastore, 'Empty', eventData, {
					createdAt: new Date(new Date() - (TEN_MINUTES * 2)),
					lastAttempt: new Date(new Date() - (TEN_MINUTES * 2)),
					nextAttempt: new Date(new Date() - TEN_MINUTES - 5),
				});

				const subscriptionDetails = await subscribe(pubsub, 'Empty', 1);
				({ subscription, messages } = subscriptionDetails);
				container.messages = messages;

				await runRequest(controller, 'httpRetry', createPostReq({}));
			});
			after(() => subscription.delete());

			it('should set nextAttempt', async () => {
				const { recordKey } = container;
				const [record] = await datastore.get(recordKey);
				expect(record.nextAttempt > record.lastAttempt, 'nextAttempt > lastAttempt');
				expect(record.processedAt, 'processedAt').to.not.eq(null);
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
				({ subscription, messages } = subscriptionDetails);
				container.messages = messages;

				await runRequest(controller, 'httpRetry', createPostReq({}));
			});
			after(() => subscription.delete());

			itPublishes(container);
			it('should not change the record', async () => {
				const [record] = await container.datastore.get(container.recordKey);
				expect(record).to.deep.eq(recordMeta);
			});
		});

		describe('WHEN record has exceeded retries', () => {
			const container = {};
			before(async () => {
				container.recordKey = await setupRecord(datastore, 'Empty', eventData, {
					retries: 8,
				});

				const subscriptionDetails = await subscribe(pubsub, 'Empty', 1);
				({ subscription, messages } = subscriptionDetails);
				container.messages = messages;

				await runRequest(controller, 'httpRetry', createPostReq({}));
			});
			after(() => subscription.delete());

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

function createPostReq(data) {
	return {
		method: 'POST',
		headers: {
			authorization: `Bearer ${TOKEN}`,
		},
		body: {
			data,
		},
	};
}

async function runRequest(fn, req) {
	const res = new MockResponse();
	await fn(req, res);
	return res;
}

function itDoesNotChangeTheRecord(container) {
	it('should not change the record', async () => {
		const [record] = await container.datastore.get(container.recordKey);
		expect(record).to.deep.eq({
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
				expect(opts[key]).to.deep.eql(expectedOpts[key]);
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
			expect(container.messages[0].key).to.deep.eq(container.recordKey);
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
	datastore.save({
		key: recordKey,
		data: record,
		excludeFromIndexes: ['data'],
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

	return controller.pubsubMessage(pubsubPayload);
}

async function asyncTimeout(time) {
	return new Promise(resolve => setTimeout(resolve, time));
}
