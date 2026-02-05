const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

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

        // Idle check interval (every hour)
        this.idleCheckInterval = setInterval(() => this.checkIdle(), 60 * 60 * 1000);
    }

    // 🆕 验证端口号是否有效
    validatePort(port) {
        const MIN_PORT = 1024;  // 非特权端口起始
        const MAX_PORT = 65535; // 最大端口号

        // 类型检查
        const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

        if (isNaN(portNum) || !Number.isInteger(portNum)) {
            const errorMsg = `Invalid port type: ${port} (type: ${typeof port}). Port must be an integer.`;
            logger.error(`[ServiceManager] ${errorMsg}`);
            throw new Error(errorMsg);
        }

        // 范围检查
        if (portNum < MIN_PORT || portNum > MAX_PORT) {
            const errorMsg = `Invalid port ${portNum}. Port must be between ${MIN_PORT} and ${MAX_PORT}.`;
            logger.error(`[ServiceManager] ${errorMsg}`);
            throw new Error(errorMsg);
        }

        logger.info(`[ServiceManager] Port ${portNum} validated successfully`);
        return portNum;
    }

    async start() {
        if (this.process) {
            logger.warn('[ServiceManager] Service already running');
            return;
        }

        logger.info(`[ServiceManager] Starting Python server on port ${this.port}...`);

        try {
            this.process = spawn(config.pythonPath, [
                this.scriptPath,
                '--port',
                this.port.toString()
            ]);

            this.process.stdout.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                lines.forEach(line => {
                    if (line) logger.info(`[PyServer] ${line}`);
                });
            });

            this.process.stderr.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                lines.forEach(line => {
                    if (!line) return;
                    
                    // Simple heuristic to detect non-error logs on stderr
                    // Python logging format: "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
                    if (line.includes(' - INFO - ') || line.includes(' - WARNING - ')) {
                        logger.info(`[PyServer] ${line}`);
                    } else {
                        logger.error(`[PyServer] ${line}`);
                    }
                });
            });

            this.process.on('exit', (code, signal) => {
                logger.warn(`[ServiceManager] Python server exited with code ${code}, signal ${signal}`);
                this.process = null;
                
                // Auto-restart if not intentionally stopped/restarting
                if (!this.isRestarting) {
                    logger.info('[ServiceManager] Attempting to restart server in 1s...');
                    setTimeout(() => this.start(), 1000);
                }
            });

            await this.waitForHealth();
            logger.info('[ServiceManager] Python server is ready');

        } catch (error) {
            logger.error('[ServiceManager] Failed to start server:', error);
            throw error;
        }
    }

    async waitForHealth(maxRetries = 20, interval = 500) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await axios.get(`${this.baseUrl}/health`);
                if (response.status === 200) {
                    return true;
                }
            } catch (e) {
                // Ignore errors while waiting
            }
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        throw new Error('Timeout waiting for Python server health check');
    }

    async sendCommand(endpoint, data) {
        // Ensure server is running
        if (!this.process) {
            await this.start();
        }

        this.lastRequestTime = Date.now();
        
        // Remove leading slash if present to avoid double slashes
        const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
        const url = `${this.baseUrl}/${cleanEndpoint}`;

        try {
            const response = await axios.post(url, data);
            return response.data;
        } catch (error) {
            logger.error(`[ServiceManager] Error sending command to ${endpoint}:`, error.message);
            throw error;
        }
    }

    async checkIdle() {
        const IDLE_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
        if (Date.now() - this.lastRequestTime > IDLE_TIMEOUT) {
            logger.info('[ServiceManager] Server idle for 24h, restarting to clear memory...');
            await this.restart();
        }
    }

    async restart() {
        this.isRestarting = true;

        try {
            if (this.process) {
                logger.info('[ServiceManager] Sending SIGTERM to Python server...');
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
                        logger.warn(`[ServiceManager] Process did not exit after ${RESTART_TIMEOUT}ms, sending SIGKILL...`);
                        this.process.kill('SIGKILL');
                        forcedKill = true;

                        // Give SIGKILL 2 more seconds to work
                        const killStartTime = Date.now();
                        while (this.process && (Date.now() - killStartTime < 2000)) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }

                        if (this.process) {
                            logger.error('[ServiceManager] Process still alive after SIGKILL, giving up');
                            // Force clear the reference to prevent infinite restart loop
                            this.process = null;
                        }
                        break;
                    }
                }

                if (forcedKill) {
                    logger.warn('[ServiceManager] Process forcefully terminated');
                } else {
                    logger.info('[ServiceManager] Process exited gracefully');
                }
            }
        } catch (error) {
            logger.error('[ServiceManager] Error during restart:', error);
            // Ensure process reference is cleared even on error
            this.process = null;
        } finally {
            // Always clear the restarting flag
            this.isRestarting = false;
        }

        // Start the service again
        await this.start();
    }
}

module.exports = new ServiceManager();
