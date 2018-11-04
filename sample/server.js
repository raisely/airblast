require('./config');
const routes = require('./config/routes');

module.exports = {};

routes.forEach((route) => { module.exports[route.path] = route.fn; });
