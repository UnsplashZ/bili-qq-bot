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
        this.port = config.biliServerPort || 10001;
        this.scriptPath = path.resolve(process.cwd(), config.biliScriptPath || 'src/services/bili_server.py');
        this.baseUrl = `http://127.0.0.1:${this.port}`;
        this.lastRequestTime = Date.now();
        this.isRestarting = false;
        
        // Idle check interval (every hour)
        this.idleCheckInterval = setInterval(() => this.checkIdle(), 60 * 60 * 1000);
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
        if (this.process) {
            this.process.kill(); // Default SIGTERM
            // Wait for exit event to clear this.process
            while (this.process) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        this.isRestarting = false;
        await this.start();
    }
}

module.exports = new ServiceManager();
