const browserManager = require('../core/browser');
const { isNightMode } = require('../core/theme');
const { escapeHtml, getCustomFonts } = require('../core/formatters');
const { generateUnifiedCSS } = require('../../../utils/designSystem');

/**
 * 生成订阅列表图片
 * @param {Object} data - 订阅数据 { users: [], bangumis: [], accountFollows: [] }
 * @param {String} groupId - 群组ID
 * @param {Boolean} show_id - 是否显示UID
 * @param {String} title - 列表标题
 * @returns {Promise<String>} Base64编码的图片
 */
async function generateSubscriptionList(data, groupId, show_id = true, title = '订阅列表') {
    await browserManager.init();
    const page = await browserManager.createPage({ width: 880, height: 1000, deviceScaleFactor: 2 });

    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const isNight = isNightMode(groupId);
    const themeClass = isNight ? 'theme-dark' : 'theme-light';

    const { css: customFontsCss, families: customFontFamilies } = getCustomFonts();

    // Unified Design System Integration
    const colorData = {
        themeClass,
        badgeColor: '#FB7299',
        gradientMix: isNight ? 'linear-gradient(135deg, #1a1a1a 0%, #2c3e50 100%)' : 'linear-gradient(135deg, #fef5f6 0%, #e8f5ff 50%, #f0f9ff 100%)',
        currentType: { label: '订阅列表', color: '#FB7299', icon: '📋' }
    };
    const viewport = { width: 880, minWidth: 400 };
    const baseCss = generateUnifiedCSS(colorData, viewport, { customFontsCss, customFontFamilies });

    const html = `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        ${baseCss}
        <style>
            body {
                margin: 0;
                padding: 0;
                background: transparent;
                font-family: ${customFontFamilies.length > 0 ? customFontFamilies.join(', ') + ', ' : ''}"MiSans", "MiSans L3", "Noto Sans SC", "Noto Color Emoji", sans-serif;
            }
            #wrapper {
                padding: 40px;
                border-radius: var(--radius-container);
                width: 800px;
                overflow: hidden;
                position: relative;
            }
            .container {
                background: var(--color-card-bg);
                border-radius: var(--radius-container);
                box-shadow: var(--shadow-card);
                border: 1px solid var(--color-border);
                padding: 28px;
                overflow: hidden;
                backdrop-filter: blur(24px);
                -webkit-backdrop-filter: blur(24px);
                position: relative;
            }
            .header {
                text-align: center;
                margin-bottom: 28px;
                border-bottom: 2px solid var(--color-border);
                padding-bottom: 20px;
            }
            .header h1 {
                margin: 0;
                font-size: var(--font-title);
                background: linear-gradient(135deg, #FB7299, #FF6699);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                font-weight: 800;
                letter-spacing: 1px;
            }
            .section {
                margin-bottom: 28px;
            }
            .section-title {
                font-size: 20px;
                font-weight: 700;
                color: var(--color-text);
                margin-bottom: 16px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .section-title::before {
                content: '';
                display: block;
                width: 5px;
                height: 20px;
                background: linear-gradient(135deg, #00A1D6, #00B5E5);
                border-radius: 3px;
                box-shadow: 0 2px 8px rgba(0, 161, 214, 0.3);
            }
            .count-badge {
                background: var(--color-primary);
                color: white;
                font-size: 12px;
                padding: 2px 8px;
                border-radius: 10px;
                font-weight: bold;
            }
            .user-list {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 16px;
            }
            .user-card {
                display: flex;
                align-items: center;
                padding: 12px;
                background-color: var(--color-soft-bg);
                border-radius: 12px;
                border: 1px solid var(--color-border);
                transition: all 0.2s;
            }
            .avatar-container {
                position: relative;
                width: 60px;
                height: 60px;
                margin-right: 16px;
                flex-shrink: 0;
            }
            .avatar {
                width: 60px;
                height: 60px;
                border-radius: 50%;
                object-fit: cover;
                border: 2px solid var(--color-card-bg);
                box-shadow: 0 2px 6px rgba(0,0,0,0.1);
            }
            .user-info {
                flex: 1;
                min-width: 0;
            }
            .user-name-row {
                display: flex;
                align-items: center;
                margin-bottom: 4px;
            }
            .user-name {
                font-size: 16px;
                font-weight: bold;
                color: var(--color-text);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-right: 8px;
            }
            .level-badge {
                font-size: 10px;
                padding: 0 4px;
                border-radius: 2px;
                background-color: #ddd;
                color: #666;
                font-weight: bold;
            }
            .level-badge.lv0 { background-color: #bfbfbf; color: #fff; }
            .level-badge.lv1 { background-color: #bfbfbf; color: #fff; }
            .level-badge.lv2 { background-color: #95ddb2; color: #fff; }
            .level-badge.lv3 { background-color: #92d1e5; color: #fff; }
            .level-badge.lv4 { background-color: #ffb37c; color: #fff; }
            .level-badge.lv5 { background-color: #ff6c00; color: #fff; }
            .level-badge.lv6 { background-color: #ff0000; color: #fff; }

            .user-details {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                font-size: 12px;
                color: var(--color-subtext);
                align-items: center;
            }
            .uid {
                font-family: monospace;
                opacity: 0.8;
            }

            .bangumi-list {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 12px;
            }
            .bangumi-card {
                padding: 12px;
                background-color: var(--color-soft-bg);
                border-radius: 12px;
                border: 1px solid var(--color-border);
                display: flex;
                align-items: center;
            }
            .bangumi-icon {
                margin-right: 8px;
                font-size: 20px;
            }
            .bangumi-title {
                font-size: 14px;
                font-weight: 500;
                color: var(--color-text);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .empty-tip {
                text-align: center;
                color: var(--color-subtext);
                padding: 20px;
                font-style: italic;
                background: rgba(0,0,0,0.02);
                border-radius: 8px;
            }
        </style>
    </head>
    <body class="${themeClass}">
        <div id="wrapper" style="background: ${colorData.gradientMix}">
            <div class="container">
                <div class="header">
                    <h1>${escapeHtml(title)}</h1>
                </div>

            <div class="section">
                <div class="section-title">
                    本群订阅 (用户)
                    <span class="count-badge">${data.users.length}</span>
                </div>
                ${data.users.length > 0 ? `
                    <div class="user-list">
                        ${data.users.map(u => {
                            return `
                            <div class="user-card">
                                <div class="avatar-container">
                                    <img src="${u.face}" class="avatar" crossorigin="anonymous">
                                </div>
                                <div class="user-info">
                                    <div class="user-name-row">
                                        <span class="user-name">${escapeHtml(u.name)}</span>
                                    </div>
                                    <div class="user-details">
                                        ${show_id ? `<span class="uid">UID:${u.uid}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                            `;
                        }).join('')}
                    </div>
                ` : '<div class="empty-tip">暂无用户订阅</div>'}
            </div>

            <div class="section" style="${data.bangumis.length === 0 ? 'display:none;' : ''}">
                <div class="section-title">
                    本群订阅 (番剧)
                    <span class="count-badge">${data.bangumis.length}</span>
                </div>
                ${data.bangumis.length > 0 ? `
                    <div class="bangumi-list">
                        ${data.bangumis.map(b => `
                            <div class="bangumi-card">
                                <span class="bangumi-icon">📺</span>
                                <span class="bangumi-title">${escapeHtml(b.title)}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : '<div class="empty-tip">暂无番剧订阅</div>'}
            </div>

            <div class="section" style="${(!data.accountFollows || data.accountFollows.length === 0) ? 'display:none;' : ''}">
                <div class="section-title">
                    ${data.accountFollowsTitle ? escapeHtml(data.accountFollowsTitle) : '账户关注列表'}
                    <span class="count-badge">${data.accountFollows ? data.accountFollows.length : 0}</span>
                </div>
                ${(data.accountFollows && data.accountFollows.length > 0) ? `
                    <div class="user-list">
                        ${data.accountFollows.map(u => {
                            return `
                            <div class="user-card">
                                <div class="avatar-container">
                                    <img src="${u.face}" class="avatar" crossorigin="anonymous">
                                </div>
                                <div class="user-info">
                                    <div class="user-name-row">
                                        <span class="user-name">${escapeHtml(u.name)}</span>
                                    </div>
                                    <div class="user-details">
                                        ${show_id ? `<span class="uid">UID:${u.uid}</span>` : ''}
                                    </div>
                                </div>
                            </div>
                            `;
                        }).join('')}
                    </div>
                ` : '<div class="empty-tip">暂无关注</div>'}
            </div>
        </div>
        </div>
    </body>
    </html>`;

    await page.setContent(html);
    const wrapper = await page.$('#wrapper');
    const buffer = await wrapper.screenshot({
        type: 'webp',
        quality: 80,
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

module.exports = { generateSubscriptionList };
