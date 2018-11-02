class Response {
	constructor() {
		this.headers = {};
	}

	send(body) {
		this.body = body;
		return this;
	}

	status(code) {
		this.statusCode = code;
		return this;
	}

	set(header, value) {
		this.headers[header] = value;
	}
}

module.exports = Response;
