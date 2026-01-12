const puppeteer = require('puppeteer');
const logger = require('../../../utils/logger');

/**
 * Puppeteer 浏览器管理器 (单例模式)
 * 负责创建和管理浏览器实例，提供页面池管理和自动清理功能
 */
class BrowserManager {
    constructor() {
        this.browser = null;
        this.pagePool = new Set(); // 页面池，追踪所有活跃页面
        this.maxPages = 5; // 最大同时打开页面数
        this.pageTimeout = 30000; // 页面超时时间（30秒）
        this.pageTimeouts = new Map(); // 页面超时定时器
        this.cleanupInterval = null; // 定期清理定时器
        this.startCleanupMonitor();
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
                        logger.warn('Detected untracked page, closing...');
                        await this.closePage(page);
                    }
                }

                // 清理状态
                const poolSize = this.pagePool.size;
                if (poolSize > 0) {
                    logger.debug(`Page pool status: ${poolSize} active pages`);
                }
            } catch (error) {
                logger.error('Error during cleanup monitor:', error);
            }
        }, 60000); // 每分钟执行一次
    }

    /**
     * 初始化浏览器实例 (懒加载)
     */
    async init() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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
            logger.info('Puppeteer browser initialized');
            
            // 监听浏览器断开连接事件
            this.browser.on('disconnected', () => {
                logger.warn('Puppeteer browser disconnected! Resetting instance...');
                this.browser = null;
                this.pagePool.clear();
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
        let lastError;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // 如果是重试，且浏览器已断开，重新初始化
                if (attempt > 0 && !this.browser) {
                    logger.info(`[Browser] Re-initializing browser for retry attempt ${attempt}...`);
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
                    logger.warn(`[Browser] Operation failed with protocol error (attempt ${attempt + 1}/${maxRetries + 1}). Retrying...`);
                    // 如果是协议错误，强制重置浏览器
                    if (this.browser) {
                        try {
                            await this.browser.close();
                        } catch (e) { /* ignore */ }
                        this.browser = null;
                        this.pagePool.clear();
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
    }

    /**
     * 等待页面池有空闲位置
     * 如果达到最大页面数，等待直到有页面被释放
     */
    async waitForAvailableSlot() {
        while (this.pagePool.size >= this.maxPages) {
            logger.warn(`Page pool full (${this.pagePool.size}/${this.maxPages}), waiting for slot...`);
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
                logger.warn('Page timeout reached, auto-closing...');
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

        logger.debug(`Page created (${this.pagePool.size}/${this.maxPages} active)`);

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

            logger.debug(`Page closed (${this.pagePool.size}/${this.maxPages} active)`);
        } catch (error) {
            logger.error('Error closing page:', error);
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
        logger.info('Cleaning up browser resources...');

        // 停止清理监控
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
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

        logger.info('Browser resources cleaned up');
    }
}

// 导出单例
module.exports = new BrowserManager();
