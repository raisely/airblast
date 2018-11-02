const Datastore = require('@google-cloud/datastore');
const Pubsub = require('@google-cloud/pubsub');
const uuidv1 = require('uuid/v1');

const serializeError = require('serialize-error');
const { expect } = require('chai');
const sinon = require('sinon');
const _ = require('lodash');

require('./specHelper');

const AirblastController = require('../../index');
const MockResponse = require('../utils/mockResponse');
const { subscribe } = require('./pubsubHelper');

class EmptyController extends AirblastController {}
class HookedController extends AirblastController {}

const hookNames = ['validate', 'beforeSave', 'afterSave', 'beforeProcess', 'process', 'afterProcess'];

hookNames.forEach((hook) => { HookedController.prototype[hook] = _.noop; });

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
				createdAt: new Date().toIsoString(),
				name: 'Amelia Telford',
				message: 'Hi there',
			};
			let res;
			const recordContainer = {};
			let subscription;
			const messages = [];

			before(async () => {
				const req = createPostReq(eventData);
				const controller = new EmptyController();

				const subscriptionDetails = await subscribe(pubsub, 'Empty', 1);
				({ subscription } = subscriptionDetails);

				res = await runRequest(controller.http, req);

				messages.concat(await subscriptionDetails.promise);
			});
			after(() => subscription.delete());

			it('returns 200', () => {
				expect(res.status).to.eq(200);
			});

			itSavesAndPublishes(datastore, eventData, messages, recordContainer);

			it('initialises record metadata', () => {
				const record = recordContainer;
				expect(record).to.deep.eql({
					createdAt: eventData.createdAt,
					processedAt: null,
					failedAt: null,
					retries: 0,
				});
				expect(record.nextAttempt).to.not.eq(null);
			});
		});

		describe('with hooks', () => {
			const hooks = [];
			const eventData = {
				format: 'text',
				text: "I'm a lumberjack and I'm ok",
			};

			before(async () => {
				const req = createPostReq(eventData);
				const controller = new HookedController();

				hooks.concat(['validate', 'beforeSave', 'afterSave']
					.map(hook => sinon.spy(controller, hook)));

				await runRequest(controller.http, req);
			});

			itCallsHook(hooks, 'validate', { data: eventData });
			itCallsHook(hooks, 'beforeSave', { data: eventData });
			itCallsHook(hooks, 'afterSave', { data: eventData, key: notNull, pubsubId: notNull });
		});
	});

	describe('enqueue', () => {
		let subscription;
		const messages = [];
		const payload = {
			all: 'The people in the world',
			stand: true,
			as: 1,
		};

		before(async () => {
			const subscriptionDetails = await subscribe(pubsub, 'Empty', 1);
			({ subscription } = subscriptionDetails);
			const controller = new EmptyController();

			await controller.enqueue(payload);

			messages.concat(await subscriptionDetails.promise);
		});
		after(() => subscription.delete());

		itSavesAndPublishes(datastore, payload, messages);
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

				container.recordKey = await setupRecord(datastore, controller, 'Empty', eventData);
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
			const hooks = [];
			const payload = { record: { data: eventData }, data: eventData };

			before(async () => {
				const controller = new HookedController();

				hooks.concat(['validate', 'beforeSave', 'afterSave']
					.map(hook => sinon.spy(controller, hook)));

				container.recordKey = await setupRecord(datastore, controller, 'Hooked', eventData);
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
				controller = new HookedController();
			});

			describe('first failure', () => {
				let record;
				let recordKey;
				const eventData = {
					beans: 'green',
				};

				before(async () => {
					controller.process = () => throw firstError;
					recordKey = await setupRecord(datastore, controller, 'Hooked', eventData);
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
					controller.process = () => throw secondError;
					recordKey = await setupRecord(datastore, controller, 'Hooked', eventData, {
						firstError, lastError: firstError,
					});
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
		describe('WHEN record just failed', () => {
			it('should set nextAttempt');
			it('should increment retries');
			it('should not enqueue');
		});
		describe('WHEN record is at nextAttempt', () => {
			it('should requeue', () => {});
			it('should not change the record', () => {});
		});
		describe('WHEN record has exceeded retries', () => {
			it('should mark the record failed', () => {

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
			authorization: `Bearer ${config.token}`,
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

function itCallsHook(spies, name, expectedOpts) {
	it(`calls ${name}`, () => {
		expect(spies[name]).to.have.been.called();
		const opts = spies[name].getCall(0).args;
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

function itSavesAndPublishes(datastore, eventData, messages, recordContainer = {}) {
	let recordKey;

	it('queues payload in pubsub', () => {
		expect(messages).to.have.length(1);
		expect(messages[0]).to.have.keys(['key']);
		recordKey = messages[0].key;
	});
	it('saves payload to datastore', () => {
		if (!recordKey) throw new Error('recordKey is null. (maybe past step failed)');

		const results = datastore.get(recordKey);
		const [record] = results;
		const data = JSON.parse(record.data);
		expect(data).to.deep.equal(eventData);

		recordContainer.record = record;
	});
}

async function setupRecord(datastore, controller, name, payload, defaults) {
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

	const pubsubPayload = {
		data: Buffer.from(JSON.stringify({
			key: recordKey,
			name,
		})),
	};

	await controller.pubsubMessage(pubsubPayload);

	return recordKey;
}
