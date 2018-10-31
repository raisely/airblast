const nock = require('nock');
const { expect } = require('chai');

const cronEngine = require('../../cronEngine');

describe('cronEngine', () => {
	let endpoint;
	before(() => new Promise((resolve) => {
		endpoint = nock('http://test.example')
			.get('/endpoint')
			.reply(200, () => {
				resolve();
				return {};
			});

		cronEngine.start([{
			schedule: '* * * * * *',
			request: {
				uri: 'http://test.example/endpoint',
			},
		}]);
	}));

	it('makes request', () => {
		// eslint-disable-next-line no-unused-expressions
		expect(endpoint.isDone()).to.be.true;
	});

	after(() => {
		cronEngine.stop();
	});
});
