const log4js = require('log4js');

const listeners = new Set();

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
        },
        stream: {
            type: {
                configure: (config, layouts) => {
                    return (loggingEvent) => {
                        const logData = {
                            timestamp: loggingEvent.startTime,
                            level: loggingEvent.level.levelStr,
                            message: loggingEvent.data.map(d =>
                                (typeof d === 'object') ? JSON.stringify(d) : String(d)
                            ).join(' ')
                        };
                        listeners.forEach(cb => cb(logData));
                    };
                }
            }
        }
    },
    categories: {
        default: { appenders: ['out', 'app', 'stream'], level: 'info' }
    }
});

const logger = log4js.getLogger();

logger.onLog = (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
};

module.exports = logger;
