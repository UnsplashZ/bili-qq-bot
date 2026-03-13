const puppeteer = require('puppeteer');
const fs = require('fs');
const logger = require('../../../utils/logger');

function browserLog(level, message, fields = {}, scope = 'svc:browser') {
    logger.logEvent(level, 'SERVICE', scope, message, fields);
}

function resolveBrowserExecutablePath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH
    }

    const candidates = [
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta',
        '/Applications/Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev'
    ]

    for (const candidate of candidates) {
        try {
            fs.accessSync(candidate, fs.constants.X_OK)
            return candidate
        } catch (e) {
            // ignore and try next
        }
    }

    return undefined
}

/**
 * Puppeteer 浏览器管理器 (单例模式)
 * 负责创建和管理浏览器实例，提供页面池管理和自动清理功能
 */
class BrowserManager {
    constructor() {
        this.browser = null;
        this.pagePool = new Set(); // 页面池，追踪所有活跃页面
        this.maxPages = 5; // 最大同时打开页面数
        this.pageTimeout = 60000; // 页面超时时间（60秒）
        this.pageTimeouts = new Map(); // 页面超时定时器
        this.idleTimeoutMs = 5 * 60 * 1000; // 浏览器空闲超时（5分钟，写死）
        this.idleCheckIntervalMs = 30 * 1000; // 空闲检查间隔（30秒）
        this.lastRequestAt = Date.now(); // 最近一次渲染请求进入时间
        this.activeRenderCount = 0; // 当前活跃渲染任务数
        this.idleCloseInProgress = false; // 空闲关闭防重入
        this.cleanupInterval = null; // 定期清理定时器
        this.idleMonitorInterval = null; // 空闲监控定时器
        this.startCleanupMonitor();
        this.startIdleMonitor();
    }

    /**
     * 启动定期清理监控
     * 每分钟检查并清理超时或泄漏的页面
     */
    startCleanupMonitor() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        this.cleanupInterval = setInterval(async () => {
            if (!this.browser) return;

            try {
                const browserPages = await this.browser.pages();
                const trackedPages = Array.from(this.pagePool);

                // 清理未被追踪的页面（可能是泄漏的页面）
                for (const page of browserPages) {
                    if (!trackedPages.includes(page) && !page.isClosed()) {
                        browserLog('warn', 'untracked-page-detected');
                        await this.closePage(page);
                    }
                }

                // 清理状态
                const poolSize = this.pagePool.size;
                if (poolSize > 0) {
                    browserLog('debug', 'page-pool-status', {
                        activePages: poolSize
                    });
                }
            } catch (error) {
                browserLog('error', 'cleanup-monitor-failed', {
                    error: logger.getErrorMessage(error)
                });
            }
        }, 60000); // 每分钟执行一次
    }

    /**
     * 启动空闲关闭监控
     * 每 30 秒检查一次，若浏览器空闲超过 5 分钟则自动关闭
     */
    startIdleMonitor() {
        if (this.idleMonitorInterval) {
            clearInterval(this.idleMonitorInterval);
        }

        this.idleMonitorInterval = setInterval(() => {
            this.checkAndCloseIdleBrowser().catch((error) => {
                browserLog('error', 'idle-browser-check-failed', {
                    error: logger.getErrorMessage(error)
                });
            });
        }, this.idleCheckIntervalMs);
    }

    /**
     * 标记渲染请求开始
     */
    markRequestStart() {
        this.lastRequestAt = Date.now();
        this.activeRenderCount += 1;
        browserLog('debug', 'render-request-started', {
            activeRenderCount: this.activeRenderCount
        });
    }

    /**
     * 标记渲染请求结束
     */
    markRequestEnd() {
        this.activeRenderCount = Math.max(0, this.activeRenderCount - 1);
        browserLog('debug', 'render-request-finished', {
            activeRenderCount: this.activeRenderCount
        });
    }

    /**
     * 清理已追踪页面状态（不触发页面关闭）
     */
    clearTrackedPageState() {
        for (const timeoutId of this.pageTimeouts.values()) {
            clearTimeout(timeoutId);
        }
        this.pageTimeouts.clear();
        this.pagePool.clear();
    }

    /**
     * 检查并关闭空闲浏览器
     */
    async checkAndCloseIdleBrowser() {
        if (!this.browser) return;
        if (this.activeRenderCount > 0) return;
        if (this.idleCloseInProgress) return;

        const idleMs = Date.now() - this.lastRequestAt;
        if (idleMs < this.idleTimeoutMs) return;

        this.idleCloseInProgress = true;
        try {
            // 二次校验，避免检查与关闭之间有新任务进入
            if (!this.browser || this.activeRenderCount > 0) {
                return;
            }

            browserLog('info', 'idle-browser-closing', {
                idleSeconds: Math.floor(idleMs / 1000)
            });
            await this.browser.close();
            this.browser = null;
            this.clearTrackedPageState();
        } finally {
            this.idleCloseInProgress = false;
        }
    }

    /**
     * 初始化浏览器实例 (懒加载)
     */
    async init() {
        if (!this.browser) {
            const executablePath = resolveBrowserExecutablePath()
            this.browser = await puppeteer.launch({
                executablePath,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-features=VizDisplayCompositor',
                    '--memory-pressure-off',
                    '--max_old_space_size=4096'
                ],
                headless: "new",
                protocolTimeout: 60000 // 增加协议超时时间到 60s
            });
            browserLog('info', 'browser-initialized', {
                executablePath
            });
            
            // 监听浏览器断开连接事件
            this.browser.on('disconnected', () => {
                browserLog('warn', 'browser-disconnected');
                this.browser = null;
                this.clearTrackedPageState();
            });
        }
    }

    /**
     * 执行带重试机制的浏览器操作
     * @param {Function} operation - 包含浏览器操作的异步函数
     * @param {Number} maxRetries - 最大重试次数
     * @returns {Promise<any>} 操作结果
     */
    async withRetry(operation, maxRetries = 1) {
        let lastError
        this.markRequestStart()

        try {
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    // 如果是重试，且浏览器已断开，重新初始化
                    if (attempt > 0 && !this.browser) {
                        browserLog('info', 'browser-reinitializing-for-retry', {
                            attempt
                        });
                        await this.init();
                    }

                    return await operation();
                } catch (error) {
                    lastError = error;
                    const isProtocolError = error.message && (
                        error.message.includes('Protocol error') ||
                        error.message.includes('Target closed') ||
                        error.message.includes('Session closed')
                    );

                    if (isProtocolError && attempt < maxRetries) {
                        browserLog('warn', 'protocol-error-retrying', {
                            attempt: attempt + 1,
                            maxAttempts: maxRetries + 1
                        });
                        // 如果是协议错误，强制重置浏览器
                        if (this.browser) {
                            try {
                                await this.browser.close();
                            } catch (e) { /* ignore */ }
                            this.browser = null;
                            this.clearTrackedPageState();
                        }
                        // 等待一小会儿再重试
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } else {
                        // 如果不是协议错误，或者是最后一次尝试，则抛出异常
                        throw error;
                    }
                }
            }
            throw lastError;
        } finally {
            this.markRequestEnd();
        }
    }

    /**
     * 等待页面池有空闲位置
     * 如果达到最大页面数，等待直到有页面被释放
     */
    async waitForAvailableSlot() {
        while (this.pagePool.size >= this.maxPages) {
            browserLog('warn', 'page-pool-full-waiting', {
                activePages: this.pagePool.size,
                maxPages: this.maxPages
            });
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    /**
     * 设置页面超时自动清理
     * @param {Page} page - Puppeteer页面实例
     */
    setupPageTimeout(page) {
        const timeoutId = setTimeout(async () => {
            if (!page.isClosed()) {
                browserLog('warn', 'page-timeout-auto-closing');
                await this.closePage(page);
            }
        }, this.pageTimeout);

        this.pageTimeouts.set(page, timeoutId);
    }

    /**
     * 清除页面超时定时器
     * @param {Page} page - Puppeteer页面实例
     */
    clearPageTimeout(page) {
        const timeoutId = this.pageTimeouts.get(page);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.pageTimeouts.delete(page);
        }
    }

    /**
     * 重新设置页面超时
     * 用于在长时间操作前后重置超时计时
     * @param {Page} page - Puppeteer页面实例
     */
    resetPageTimeout(page) {
        this.clearPageTimeout(page);
        this.setupPageTimeout(page);
    }

    /**
     * 创建新页面
     * @param {Object} viewport - 视口配置 (width, height, deviceScaleFactor)
     * @returns {Promise<Page>} Puppeteer Page 实例
     */
    async createPage(viewport) {
        await this.init();
        await this.waitForAvailableSlot();

        const page = await this.browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        if (viewport) {
            await page.setViewport(viewport);
        }

        // 添加到页面池并设置超时
        this.pagePool.add(page);
        this.setupPageTimeout(page);

        browserLog('debug', 'page-created', {
            activePages: this.pagePool.size,
            maxPages: this.maxPages
        });

        return page;
    }

    /**
     * 安全关闭页面
     * @param {Page} page - 要关闭的页面实例
     */
    async closePage(page) {
        if (!page) return;

        try {
            // 清除超时定时器
            this.clearPageTimeout(page);

            // 从页面池中移除
            this.pagePool.delete(page);

            // 关闭页面
            if (!page.isClosed()) {
                await page.close();
            }

            browserLog('debug', 'page-closed', {
                activePages: this.pagePool.size,
                maxPages: this.maxPages
            });
        } catch (error) {
            browserLog('error', 'page-close-failed', {
                error: logger.getErrorMessage(error)
            });
            // 即使出错也要从池中移除
            this.pagePool.delete(page);
        }
    }

    /**
     * 获取浏览器实例 (兼容原代码)
     */
    getBrowser() {
        return this.browser;
    }

    /**
     * 获取页面池统计信息
     */
    getPoolStats() {
        return {
            active: this.pagePool.size,
            max: this.maxPages,
            available: this.maxPages - this.pagePool.size
        };
    }

    /**
     * 清理所有资源（用于程序退出时）
     */
    async cleanup() {
        browserLog('info', 'browser-cleanup-started');

        // 停止清理监控
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        if (this.idleMonitorInterval) {
            clearInterval(this.idleMonitorInterval);
            this.idleMonitorInterval = null;
        }

        // 关闭所有页面
        const pages = Array.from(this.pagePool);
        for (const page of pages) {
            await this.closePage(page);
        }

        // 关闭浏览器
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
        this.clearTrackedPageState();
        this.activeRenderCount = 0;
        this.idleCloseInProgress = false;

        browserLog('info', 'browser-cleanup-finished');
    }
}

// 导出单例
module.exports = new BrowserManager();
