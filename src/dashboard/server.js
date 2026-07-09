const express = require('express');
const cors = require('cors');
const path = require('path');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { logBuffer, matchesFilters } = require('./logBuffer');
const apiRoutes = require('./routes/api');
const sysConfig = require('../config');
const { csrfProtection } = require('./middleware/auth'); // 🆕 P2-2
const updateChecker = require('../services/subscription/updateChecker');
const qqProviderRuntime = require('../providers/qq/runtime');

let server = null;
let wss = null;
let logUnsubscribe = null;

function buildPublicProviderStatus(providerStatus) {
    if (!providerStatus) return null;
    return {
        id: providerStatus.id || 'unknown',
        name: providerStatus.name || providerStatus.id || 'unknown',
        connectionState: providerStatus.connectionState || providerStatus.gateway?.state || 'unknown',
        readyState: providerStatus.readyState ?? null
    };
}

function buildStatusPayload() {
    let subscription = null;
    try {
        subscription = typeof updateChecker.getStatus === 'function'
            ? updateChecker.getStatus()
            : null;
    } catch (error) {
        subscription = {
            runtime: {
                startState: 'error',
                startupPending: false,
                initialized: false,
                initializing: false,
                ready: false,
                lastError: logger.getErrorMessage(error),
                lastErrorAt: Date.now()
            }
        };
    }

    const runtime = subscription?.runtime || {};
    const subscriptionState = runtime.lastError || runtime.startState === 'error'
        ? 'degraded'
        : (runtime.ready || subscription?.running ? 'ok' : 'starting');
    const providerStatus = qqProviderRuntime.getProviderStatus();
    const publicProviderStatus = buildPublicProviderStatus(providerStatus);
    const providerState = providerStatus
        ? (providerStatus.connectionState === 'ready' || providerStatus.gateway?.state === 'ready' ? 'ok' : 'starting')
        : 'not_started';

    return {
        status: subscriptionState === 'degraded'
            ? 'degraded'
            : (subscriptionState === 'ok' ? 'ok' : 'starting'),
        uptime: process.uptime(),
        components: {
            dashboard: 'ok',
            subscriptionRuntime: subscriptionState,
            qqProvider: providerState
        },
        qqProvider: publicProviderStatus,
        subscription
    };
}

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

            app.use('/qq-official-temp', express.static(path.join(sysConfig.napcatTempPath, 'qq-official-temp'), {
                index: false,
                maxAge: '10m',
                immutable: false
            }));

            // 🆕 P2-2: CSRF保护（应用于所有API路由）
            app.use('/api', csrfProtection);

            // Health check endpoint (Public, must be before API routes middleware)
            app.get('/api/status', (req, res) => {
                res.json(buildStatusPayload());
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
                logger.logEvent('info', 'DASH', 'svc:lifecycle', 'server-started', {
                    port
                });

                // Initialize WebSocket Server
                wss = new WebSocket.Server({ server, path: '/ws/logs' });

                wss.on('connection', (ws, req) => {
                    // Extract token from query string
                    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
                    const token = url.searchParams.get('token');
                    ws.logFilters = {
                        level: url.searchParams.get('level') || undefined,
                        channels: url.searchParams.get('channels')
                            ? url.searchParams.get('channels').split(',').map((item) => item.trim()).filter(Boolean)
                            : undefined,
                        keyword: url.searchParams.get('keyword') || undefined
                    };

                    if (!token) {
                        logger.logEvent('warn', 'AUTH', 'svc:lifecycle', 'ws-token-missing', {});
                        ws.close(1008, 'Token required');
                        return;
                    }

                    try {
                        jwt.verify(token, sysConfig.jwtSecret);
                    } catch (err) {
                        logger.logEvent('warn', 'AUTH', 'svc:lifecycle', 'ws-token-invalid', {
                            error: logger.getErrorMessage(err)
                        });
                        ws.close(1008, 'Authentication failed');
                        return;
                    }

                    // Connection successful
                });

                // Subscribe to logger if not already subscribed
                if (!logUnsubscribe) {
                    logUnsubscribe = logger.onLog((logEvent) => {
                        logBuffer.push(logEvent);
                        if (wss) {
                            wss.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    if (!matchesFilters(logEvent, client.logFilters || {})) {
                                        return;
                                    }
                                    client.send(JSON.stringify(logEvent));
                                }
                            });
                        }
                    });
                }

                resolve();
            });

            server.on('error', (err) => {
                logger.logEvent('error', 'DASH', 'svc:lifecycle', 'server-error', {
                    error: logger.getErrorMessage(err)
                });
                reject(err);
            });

        } catch (error) {
            logger.logEvent('error', 'DASH', 'svc:lifecycle', 'server-start-failed', {
                error: logger.getErrorMessage(error)
            });
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
            logger.logEvent('info', 'DASH', 'svc:lifecycle', 'server-stopped');
        });
        server = null;
    }
}

module.exports = {
    start,
    stop,
    buildStatusPayload,
    buildPublicProviderStatus
};
