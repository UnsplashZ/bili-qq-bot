const browserManager = require('../core/browser');
const { isNightMode, calculateViewport, getTypeConfig, calculateColors, generateCSS } = require('../core/theme');
const { renderVideoContent } = require('../renderers/video');
const { renderBangumiContent } = require('../renderers/bangumi');
const { renderArticleContent } = require('../renderers/article');
const { renderLiveContent } = require('../renderers/live');
const { renderDynamicContent } = require('../renderers/dynamic');
const { renderUserContent } = require('../renderers/user');
const config = require('../../../config');

/**
 * 渲染类型标签
 * @param {String} type - 内容类型
 * @param {Object} data - 内容数据
 * @param {String} groupId - 群组ID
 * @param {Object} currentType - 当前类型配置
 * @returns {String} HTML 字符串
 */
function renderTypeBadge(type, data, groupId, currentType) {
    const labelConfig = config.getGroupConfig(groupId, 'labelConfig');
    let subtype = type;
    if (type === 'bangumi' && data.data) {
        const st = data.data.season_type;
        if (st === 2) subtype = 'movie';
        else if (st === 3) subtype = 'doc';
        else if (st === 4) subtype = 'guochuang';
        else if (st === 5) subtype = 'tv';
        else if (st === 7) subtype = 'variety';
    }

    const isVisible = (labelConfig && labelConfig[subtype] !== undefined)
        ? labelConfig[subtype]
        : (labelConfig && labelConfig[type] !== false);

    if (!isVisible) return '';

    return `
        <div class="type-badge">
            <span>${currentType.icon}</span>
            <span>${currentType.label}</span>
        </div>`;
}

/**
 * 生成预览卡片图片
 * @param {Object} data - 内容数据
 * @param {String} type - 内容类型 (video, bangumi, dynamic, article, live, user)
 * @param {String} groupId - 群组ID
 * @param {Boolean} show_id - 是否显示UID (仅用于user类型)
 * @returns {Promise<String>} Base64编码的图片
 */
async function generatePreviewCard(data, type, groupId, show_id = true) {
    await browserManager.init();
    const page = await browserManager.createPage({ width: 1200, height: 1200, deviceScaleFactor: 1.1 });

    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Logic extraction
    const viewport = calculateViewport(type, data);
    await page.setViewport(viewport);

    const isNight = isNightMode(groupId);
    const typeConfig = getTypeConfig(type, data);
    const colorData = calculateColors(type, data, typeConfig, isNight);

    // Generate CSS
    const css = generateCSS(colorData, viewport);

    // Render Content
    let contentHtml = '';
    if (type === 'video') {
        contentHtml = renderVideoContent(data);
    } else if (type === 'bangumi') {
        contentHtml = renderBangumiContent(data);
    } else if (type === 'article') {
        contentHtml = renderArticleContent(data);
    } else if (type === 'live') {
        contentHtml = renderLiveContent(data);
    } else if (type === 'dynamic') {
        contentHtml = renderDynamicContent(data);
    } else if (type === 'user') {
        contentHtml = renderUserContent(data, show_id);
    }

    // Generate Type Badge HTML
    const typeBadgeHtml = renderTypeBadge(type, data, groupId, typeConfig);

    // Assemble Final HTML
    const fullHtml = `<html><head>${css}</head><body>
        <div class="container ${colorData.themeClass} gradient-bg ${type === 'article' ? 'article-mode' : ''}" style="--gradient-mix:${colorData.gradientMix}">
            ${typeBadgeHtml}
            <div class="card">
                ${contentHtml}
            </div>
        </div>
    </body></html>`;

    await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.container', { timeout: 5000 });
    await new Promise(r => setTimeout(r, 300));
    const container = await page.$('.container');
    const buffer = await container.screenshot({
        type: 'png',
        omitBackground: true
    });

        return buffer.toString('base64');
    } catch (error) {
        throw error;
    } finally {
        // 确保页面在任何情况下都会被关闭
        await browserManager.closePage(page);
    }
}

module.exports = { generatePreviewCard };
