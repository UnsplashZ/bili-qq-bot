const log4js = require('log4js');

log4js.configure({
    appenders: { 
        out: { type: 'stdout' },
        app: { 
            type: 'dateFile', 
            filename: 'logs/application.log',
            pattern: '.yyyy-MM-dd',
            compress: true,
            numBackups: 7,
            keepFileExt: true
        }
    },
    categories: { 
        default: { appenders: ['out', 'app'], level: 'info' } 
    }
});

const logger = log4js.getLogger();

module.exports = logger;
