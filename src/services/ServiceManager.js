const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const { performance } = require('perf_hooks');
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const PY_LOG_BRIDGE_PREFIX = '__PYLOG__';
const PYTHON_LOG_PATTERN = /^(\d{4}-\d{2}-\d{2} [\d:,]+) - ([\w.]+) - ([A-Z]+) - (.*)$/;
const LEVEL_MAP = {
    TRACE: 'trace',
    DEBUG: 'debug',
    INFO: 'info',
    WARNING: 'warn',
    WARN: 'warn',
    ERROR: 'error',
    CRITICAL: 'fatal',
    FATAL: 'fatal'
};

class ServiceManager {
    constructor() {
        if (ServiceManager.instance) {
            return ServiceManager.instance;
        }
        ServiceManager.instance = this;

        this.process = null;

        // 🆕 验证端口参数
        const rawPort = config.biliServerPort || 10001;
        this.port = this.validatePort(rawPort);

        this.scriptPath = path.resolve(process.cwd(), config.biliScriptPath || 'src/services/bili_server.py');
        this.baseUrl = `http://127.0.0.1:${this.port}`;
        this.lastRequestTime = Date.now();
        this.isRestarting = false;
        this.stdoutBuffer = '';
        this.stderrBuffer = '';

        // 崩溃计数（5分钟滑动窗口）
        this.crashCount = 0;
        this.crashWindowStart = null;
        this.CRASH_WINDOW_MS = 5 * 60 * 1000;  // 5分钟窗口
        this.CRASH_THRESHOLD = 3;              // 5分钟内崩溃3次触发通知
        this.onCriticalError = null;           // 回调，由外部注册

        // Idle check interval (every hour)
        this.idleCheckInterval = setInterval(() => this.checkIdle(), 60 * 60 * 1000);
        if (typeof this.idleCheckInterval.unref === 'function') {
            this.idleCheckInterval.unref();
        }
    }

    // 🆕 验证端口号是否有效
    validatePort(port) {
        const MIN_PORT = 1024;  // 非特权端口起始
        const MAX_PORT = 65535; // 最大端口号

        // 类型检查
        const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

        if (isNaN(portNum) || !Number.isInteger(portNum)) {
            const errorMsg = `Invalid port type: ${port} (type: ${typeof port}). Port must be an integer.`;
            logger.logEvent('error', 'PY', 'svc:lifecycle', 'port-invalid', { error: errorMsg });
            throw new Error(errorMsg);
        }

        // 范围检查
        if (portNum < MIN_PORT || portNum > MAX_PORT) {
            const errorMsg = `Invalid port ${portNum}. Port must be between ${MIN_PORT} and ${MAX_PORT}.`;
            logger.logEvent('error', 'PY', 'svc:lifecycle', 'port-invalid', { error: errorMsg });
            throw new Error(errorMsg);
        }

        logger.logEvent('info', 'PY', 'svc:lifecycle', 'port-validated', { port: portNum });
        return portNum;
    }

    async start() {
        if (this.process) {
            logger.logEvent('warn', 'PY', 'svc:lifecycle', 'already-running', { port: this.port });
            return;
        }

        if (await this.isServiceHealthy(300)) {
            logger.logEvent('info', 'PY', 'svc:lifecycle', 'reuse-existing', { port: this.port });
            return;
        }

        logger.logEvent('info', 'PY', 'svc:lifecycle', 'start', { port: this.port });

        try {
            this.process = spawn(config.pythonPath, [
                this.scriptPath,
                '--port',
                this.port.toString()
            ], {
                env: {
                    ...process.env,
                    BILI_PY_LOG_BRIDGE: '1',
                    PYTHONUNBUFFERED: '1'
                }
            });

            this.process.stdout.on('data', (data) => {
                this.handlePythonStream('stdout', data);
            });

            this.process.stderr.on('data', (data) => {
                this.handlePythonStream('stderr', data);
            });

            this.process.on('exit', (code, signal) => {
                logger.logEvent('warn', 'PY', 'svc:lifecycle', 'exit', { code, signal: signal || 'null' });
                this.process = null;

                // 仅在非主动重启时计入崩溃计数
                if (!this.isRestarting) {
                    // 崩溃计数（5分钟滑动窗口）
                    const now = Date.now();
                    if (!this.crashWindowStart || now - this.crashWindowStart > this.CRASH_WINDOW_MS) {
                        this.crashWindowStart = now;
                        this.crashCount = 1;
                    } else {
                        this.crashCount++;
                    }

                    if (this.crashCount === this.CRASH_THRESHOLD && this.onCriticalError) {
                        this.onCriticalError(`⚠️ Python服务在5分钟内已崩溃 ${this.crashCount} 次，可能存在严重问题，请检查日志。`);
                    }

                    logger.logEvent('warn', 'PY', 'svc:lifecycle', 'restart-scheduled', {
                        delay: '1s',
                        crashCount: this.crashCount
                    });
                    setTimeout(() => this.start(), 1000);
                }
            });

            await this.waitForHealth();
            logger.logEvent('info', 'PY', 'svc:lifecycle', 'ready', { port: this.port });

        } catch (error) {
            logger.logEvent('error', 'PY', 'svc:lifecycle', 'start-failed', {
                port: this.port,
                error: error.message
            });
            throw error;
        }
    }

    async waitForHealth(maxRetries = 20, interval = 500) {
        for (let i = 0; i < maxRetries; i++) {
            if (await this.isServiceHealthy(interval)) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        throw new Error('Timeout waiting for Python server health check');
    }

    async isServiceHealthy(timeout = 500) {
        try {
            const response = await axios.get(`${this.baseUrl}/health`, { timeout });
            return response.status === 200;
        } catch (e) {
            return false;
        }
    }

    async sendCommand(endpoint, data, options = {}) {
        // Ensure server is running
        if (!this.process) {
            await this.start();
        }

        this.lastRequestTime = Date.now();
        
        // Remove leading slash if present to avoid double slashes
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
        const url = `${this.baseUrl}/${cleanEndpoint}`;
        const timeoutMs = Number(options.timeoutMs);
        const reqId = options.reqId || this.createReqId(cleanEndpoint);
        const logFields = {
            endpoint: cleanEndpoint,
            ...this.extractResourceFields(data)
        };
        const requestOptions = {
            ...(Number.isFinite(timeoutMs) && timeoutMs > 0 ? { timeout: timeoutMs } : {}),
            headers: {
                'x-request-id': reqId,
                'x-rpc-endpoint': cleanEndpoint,
                ...(options.headers || {})
            }
        };
        const startedAt = performance.now();

        logger.logEvent('info', 'RPC', `req:${reqId}`, 'start', logFields);

        try {
            const response = await axios.post(url, data, requestOptions);
            const status = response?.data?.status || response?.status || 'unknown';
            const level = status === 'success' ? 'info' : 'warn';
            logger.logEvent(level, 'RPC', `req:${reqId}`, 'done', {
                ...logFields,
                status,
                duration: `${Math.round(performance.now() - startedAt)}ms`
            });
            return response.data;
        } catch (error) {
            logger.logEvent('error', 'RPC', `req:${reqId}`, 'fail', {
                ...logFields,
                duration: `${Math.round(performance.now() - startedAt)}ms`,
                error: error.message
            });
            throw error;
        }
    }

    async checkIdle() {
        const IDLE_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
        if (Date.now() - this.lastRequestTime > IDLE_TIMEOUT) {
            logger.logEvent('info', 'PY', 'svc:lifecycle', 'restart-idle', { idle: '24h' });
            await this.restart();
        }
    }

    async restart() {
        this.isRestarting = true;

        try {
            if (this.process) {
                logger.logEvent('info', 'PY', 'svc:lifecycle', 'stop', { signal: 'SIGTERM' });
                this.process.kill('SIGTERM');

                // 🆕 添加10秒超时机制
                const RESTART_TIMEOUT = 10000; // 10 seconds
                const startTime = Date.now();
                let forcedKill = false;

                // Wait for exit event to clear this.process (with timeout)
                while (this.process) {
                    await new Promise(resolve => setTimeout(resolve, 100));

                    const elapsed = Date.now() - startTime;
                    if (elapsed > RESTART_TIMEOUT) {
                        logger.logEvent('warn', 'PY', 'svc:lifecycle', 'force-kill', {
                            timeout: `${RESTART_TIMEOUT}ms`,
                            signal: 'SIGKILL'
                        });
                        this.process.kill('SIGKILL');
                        forcedKill = true;

                        // Give SIGKILL 2 more seconds to work
                        const killStartTime = Date.now();
                        while (this.process && (Date.now() - killStartTime < 2000)) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }

                        if (this.process) {
                            logger.logEvent('error', 'PY', 'svc:lifecycle', 'force-kill-failed');
                            // Force clear the reference to prevent infinite restart loop
                            this.process = null;
                        }
                        break;
                    }
                }

                if (forcedKill) {
                    logger.logEvent('warn', 'PY', 'svc:lifecycle', 'terminated', { mode: 'force' });
                } else {
                    logger.logEvent('info', 'PY', 'svc:lifecycle', 'terminated', { mode: 'graceful' });
                }
            }
        } catch (error) {
            logger.logEvent('error', 'PY', 'svc:lifecycle', 'restart-failed', { error: error.message });
            // Ensure process reference is cleared even on error
            this.process = null;
        } finally {
            // Always clear the restarting flag
            this.isRestarting = false;
        }

        // Start the service again
        await this.start();
    }

    createReqId(endpoint) {
        const aliasMap = {
            dynamic_detail: 'dy',
            user_dynamic: 'ud',
            video: 'vd',
            bangumi: 'bg',
            article: 'ar',
            live_room: 'lv',
            user_info: 'ui',
            user_card: 'uc',
            opus: 'op',
            media: 'md',
            ep: 'ep'
        };
        const prefix = aliasMap[endpoint] || endpoint.slice(0, 2) || 'py';
        return `${prefix}_${crypto.randomBytes(3).toString('hex')}`;
    }

    extractResourceFields(data = {}) {
        const fieldMap = {
            bvid: 'bvid',
            uid: 'uid',
            cvid: 'cvid',
            season_id: 'seasonId',
            room_id: 'roomId',
            dynamic_id: 'dynamicId',
            opus_id: 'opusId',
            media_id: 'mediaId',
            ep_id: 'epId',
            group_id: 'groupId'
        };
        return Object.entries(fieldMap).reduce((acc, [key, label]) => {
            const value = data?.[key];
            if (value !== undefined && value !== null && value !== '') {
                acc[label] = value;
            }
            return acc;
        }, {});
    }

    handlePythonStream(streamName, data) {
        const bufferKey = streamName === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
        this[bufferKey] += data.toString();
        const lines = this[bufferKey].split('\n');
        this[bufferKey] = lines.pop();
        lines.forEach((line) => this.handlePythonLine(streamName, line.trimEnd()));
    }

    handlePythonLine(streamName, line) {
        if (!line) return;

        if (line.startsWith(PY_LOG_BRIDGE_PREFIX)) {
            try {
                const payload = JSON.parse(line.slice(PY_LOG_BRIDGE_PREFIX.length));
                logger.logEvent(
                    payload.level || 'info',
                    payload.channel || 'PY',
                    payload.scope || `py:${streamName}`,
                    payload.message || '',
                    payload.fields || {}
                );
                return;
            } catch (error) {
                logger.logEvent('warn', 'PY', 'svc:lifecycle', 'bridge-parse-failed', {
                    source: streamName,
                    error: error.message
                });
            }
        }

        const parsed = this.parsePythonLine(line);
        if (parsed) {
            logger.logEvent(parsed.level, parsed.channel, parsed.scope, parsed.message, parsed.fields);
            return;
        }

        logger.logEvent(streamName === 'stderr' ? 'error' : 'info', 'PY', `py:${streamName}`, line);
    }

    parsePythonLine(line) {
        const match = line.match(PYTHON_LOG_PATTERN);
        if (!match) return null;

        const [, timestamp, loggerName, levelName, message] = match;
        const level = LEVEL_MAP[levelName] || 'info';
        const scope = this.resolvePythonScope(loggerName);
        return {
            level,
            channel: this.resolvePythonChannel(loggerName),
            scope,
            message,
            fields: { ts: timestamp }
        };
    }

    resolvePythonChannel(loggerName) {
        if (loggerName === 'aiohttp.access') return 'HTTP';
        if (loggerName.includes('.services.')) return 'SERVICE';
        if (loggerName.includes('.web.handlers')) return 'RPC';
        return 'PY';
    }

    resolvePythonScope(loggerName) {
        if (loggerName.endsWith('.main') || loggerName.endsWith('.app')) {
            return 'svc:lifecycle';
        }
        const segments = String(loggerName || '').split('.');
        return `py:${segments[segments.length - 1] || 'service'}`;
    }
}

module.exports = new ServiceManager();
