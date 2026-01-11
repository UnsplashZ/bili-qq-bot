const { escapeHtml, formatPubTime, formatNumber } = require('../core/formatters');
const ICONS = require('./icons');

/**
 * 渲染专栏内容
 * @param {Object} data - 专栏数据
 * @returns {String} HTML 字符串
 */
function renderArticleContent(data) {
    const info = data.data;
    const pubDate = formatPubTime(info.publish_time);
    const authorFace = info.author_face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';

    return `
        <div class="content">
            <div class="header">
                <div class="header-left">
                    <div class="avatar-wrapper">
                        <img class="avatar no-frame" src="${authorFace}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                    </div>
                    <div class="user-info">
                        <span class="user-name">${escapeHtml(info.author_name || 'Unknown')}</span>
                        <span class="pub-time">${pubDate}</span>
                    </div>
                </div>
            </div>
            <div class="title">${escapeHtml(info.title)}</div>
            <div class="text-content truncated" ${info.html_content ? 'style="white-space: normal;"' : ''}>${info.html_content || escapeHtml(info.summary || '')}</div>
            <div class="stats" style="margin-top: 20px;">
                <span class="stat-item">${ICONS.share} ${formatNumber(info.stats?.share)}</span>
                <span class="stat-item">${ICONS.like} ${formatNumber(info.stats?.like)}</span>
                <span class="stat-item">${ICONS.comment} ${formatNumber(info.stats?.reply)}</span>
            </div>
        </div>
    `;
}

module.exports = { renderArticleContent };
