const { escapeHtml, formatDuration, formatPubTime, formatNumber } = require('../core/formatters');
const ICONS = require('./icons');
const { renderVerifyBadge } = require('./components/verifyBadge');

/**
 * 渲染视频内容
 * @param {Object} data - 视频数据
 * @returns {String} HTML 字符串
 */
function renderVideoContent(data) {
    const info = data.data;
    const owner = info.owner || {};
    const ownerFace = owner.face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';
    const ownerName = owner.name || 'Unknown';
    const verifyType = Number(owner.official_verify?.type);
    const verifyBadgeHtml = renderVerifyBadge(verifyType, 'author-verify-badge--video');
    const durationStr = info.duration ? ` • 时长: ${formatDuration(info.duration)}` : '';
    return `
        <div class="cover-container">
            <img class="cover video" src="${info.pic}" />
        </div>
        <div class="content">
            <div class="header">
                <div class="header-left">
                    <div class="avatar-wrapper">
                        <img class="avatar no-frame" src="${ownerFace}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                        ${verifyBadgeHtml}
                    </div>
                    <div class="user-info">
                        <span class="user-name">${escapeHtml(ownerName)}</span>
                        <span class="pub-time">${formatPubTime(info.pubdate)}${durationStr}</span>
                    </div>
                </div>
            </div>
            <div class="title">${escapeHtml(info.title)}</div>
            <div class="stats video-stats">
                <span class="stat-item">${ICONS.view} ${formatNumber(info.view?.count || info.stat?.view)}</span>
                <span class="stat-item">${ICONS.like} ${formatNumber(info.like || info.stat?.like)}</span>
                <span class="stat-item">${ICONS.comment} ${formatNumber(info.reply || info.stat?.reply)}</span>
            </div>
            ${info.desc ? `<div class="text-content">${escapeHtml(info.desc)}</div>` : ''}
        </div>
    `;
}

module.exports = { renderVideoContent };
