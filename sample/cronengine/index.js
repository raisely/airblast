const cronEngine = require('airblast/cronEngine');
const crontab = require('./crontab');

cronEngine.start(crontab);
