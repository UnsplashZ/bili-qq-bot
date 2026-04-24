const { generatePreviewCard } = require('./generators/previewCard');
const { generateSubscriptionList } = require('./generators/subscriptionList');
const { generateHelpCard } = require('./generators/helpCard');
const { isNightMode } = require('./core/theme');
const { formatPubTime, formatNumber } = require('./core/formatters');
const browserManager = require('./core/browser');

/**
 * ImageGenerator 主类
 * 提供与原monolithic文件完全一致的公共API
 * 确保外部调用方无需修改代码
 */
class ImageGenerator {
    constructor() {
        // 保持单例模式兼容性
        this.browser = null; // 将由 browserManager 管理，保留此属性以兼容可能的外部访问
    }

    /**
     * 初始化浏览器实例
     * @returns {Promise<void>}
     */
    async init() {
        await browserManager.init();
        this.browser = browserManager.browser; // 同步引用以保持兼容性
    }

    /**
     * 生成预览卡片图片
     * @param {Object} data - 内容数据
     * @param {String} type - 内容类型 (video, bangumi, dynamic, article, live, user)
     * @param {String} groupId - 群组ID
     * @param {Boolean} show_id - 是否显示UID (仅用于user类型)
     * @returns {Promise<String>} Base64编码的图片
     */
    async generatePreviewCard(data, type, groupId, show_id = true) {
        return generatePreviewCard(data, type, groupId, show_id);
    }

    /**
     * 生成订阅列表图片
     * @param {Object} data - 订阅数据 { users: [], bangumis: [], accountFollows: [] }
     * @param {String} groupId - 群组ID
     * @param {Boolean} show_id - 是否显示UID
     * @param {String} title - 列表标题
     * @returns {Promise<String>} Base64编码的图片
     */
    async generateSubscriptionList(data, groupId, show_id = true, title = '订阅列表') {
        return generateSubscriptionList(data, groupId, show_id, title);
    }

    /**
     * 生成帮助卡片图片
     * @param {String} type - 帮助类型 ('user' 或 'admin')
     * @param {String} groupId - 群组ID
     * @returns {Promise<String>} Base64编码的图片
     */
    async generateHelpCard(type = 'user', groupId) {
        return generateHelpCard(type, groupId);
    }

    /**
     * 判断是否为深色模式
     * @param {String} groupId - 群组ID
     * @returns {Boolean} 是否深色模式
     */
    isNightMode(groupId) {
        return isNightMode(groupId);
    }

    /**
     * 格式化发布时间
     * @param {Number} timestamp - 时间戳（秒）
     * @returns {String} 格式化的时间字符串
     */
    formatPubTime(timestamp) {
        return formatPubTime(timestamp);
    }

    /**
     * 格式化数字（添加千位分隔符或万/亿单位）
     * @param {Number} num - 数字
     * @returns {String} 格式化的数字字符串
     */
    formatNumber(num) {
        return formatNumber(num);
    }

    /**
     * 清理所有资源（用于程序退出时）
     * @returns {Promise<void>}
     */
    async cleanup() {
        await browserManager.cleanup();
    }

    /**
     * 获取页面池统计信息
     * @returns {Object} 统计信息
     */
    getPoolStats() {
        return browserManager.getPoolStats();
    }
}

// 导出单例实例，保持与原文件完全一致的导出方式
module.exports = new ImageGenerator();
