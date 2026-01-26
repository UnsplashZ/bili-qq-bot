const express = require('express');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const apiRoutes = require('./routes/api');
const sysConfig = require('../config');

let server = null;
let wss = null;
let logUnsubscribe = null;

/**
 * Start the dashboard server
 * @param {number} port - The port to listen on
 * @returns {Promise<void>} Resolves when server is listening
 */
function start(port = 3000) {
    return new Promise((resolve, reject) => {
        try {
            const app = express();

            // Middleware
            app.use(cors());
            app.use(express.json());

            // Health check endpoint (Public, must be before API routes middleware)
            app.get('/api/status', (req, res) => {
                res.json({
                    status: 'ok',
                    uptime: process.uptime()
                });
            });

            // API Routes
            app.use('/api', apiRoutes);

            // Serve static files from dashboard/dist
            // Resolved relative to this file: src/dashboard/server.js -> ../../dashboard/dist
            const distPath = path.join(__dirname, '../../dashboard/dist');
            app.use(express.static(distPath));

            // Catch-all route for client-side routing
            // Using Regex to match all routes as Express 5/path-to-regexp has stricter string pattern matching
            app.get(/(.*)/, (req, res) => {
                res.sendFile(path.join(distPath, 'index.html'));
            });

            // Start server
            server = app.listen(port, () => {
                logger.info(`Dashboard server listening on port ${port}`);

                // Initialize WebSocket Server
                wss = new WebSocket.Server({ server, path: '/ws/logs' });

                wss.on('connection', (ws, req) => {
                    // Extract token from query string
                    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
                    const token = url.searchParams.get('token');

                    if (!token) {
                        logger.warn('WebSocket connection rejected: No token provided');
                        ws.close(1008, 'Token required');
                        return;
                    }

                    try {
                        jwt.verify(token, sysConfig.jwtSecret);
                    } catch (err) {
                        logger.warn('WebSocket connection rejected: Invalid token');
                        ws.close(1008, 'Authentication failed');
                        return;
                    }

                    // Connection successful
                });

                // Subscribe to logger if not already subscribed
                if (!logUnsubscribe) {
                    logUnsubscribe = logger.onLog((logEvent) => {
                        if (wss) {
                            wss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify(logEvent));
                                }
                            });
                        }
                    });
                }

                resolve();
            });

            server.on('error', (err) => {
                logger.error('Dashboard server error:', err);
                reject(err);
            });

        } catch (error) {
            logger.error('Failed to start dashboard server:', error);
            reject(error);
        }
    });
}

/**
 * Stop the dashboard server (useful for graceful shutdown)
 */
function stop() {
    if (logUnsubscribe) {
        logUnsubscribe();
        logUnsubscribe = null;
    }

    if (wss) {
        wss.close();
        wss = null;
    }

    if (server) {
        server.close(() => {
            logger.info('Dashboard server stopped');
        });
        server = null;
    }
}

module.exports = {
    start,
    stop
};
