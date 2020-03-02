const nock = require('nock');
const request = require('request-promise-native');
const { expect } = require('chai');

const cronEngine = require('../../cronEngine');

describe('cronEngine', () => {
	let endpoint;
	let response;
	const port = 8989;

	before(() => {
		process.env.PORT = port;
		return cronEngine.start([{
			request: {
				uri: 'http://test.example/endpoint',
			},
		}]);
	});
	after(() => {
		cronEngine.stop();
	});

	describe('retry', () => {
		before(async () => {
			endpoint = nock('http://test.example')
				.get('/endpoint')
				.reply(200, {});

			response = await request({
				uri: `http://127.0.0.1:${port}/retry`,
				resolveWithFullResponse: true,
			});
		});
		it('makes request', () => {
			// eslint-disable-next-line no-unused-expressions
			expect(endpoint.isDone()).to.be.true;
		});
		it('status is 200', () => {
			expect(response.statusCode).to.eq(200);
		});
	});

	describe('health', () => {
		before(async () => {
			response = await request({
				uri: `http://127.0.0.1:${port}/_ah/start`,
				resolveWithFullResponse: true,
			});
		});
		it('status is 200', () => {
			expect(response.statusCode).to.eq(200);
		});
	});
});
