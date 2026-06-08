const { escapeHtml, formatDuration, formatPubTime, formatNumber } = require('../core/formatters');
const ICONS = require('./icons');
const { parseRichText } = require('./components/richtext');
const { resolvePlainTextContent } = require('./components/contentNodes');
const { renderVerifyBadge } = require('./components/verifyBadge');

/**
 * 渲染视频内容
 * @param {Object} data - 视频数据
 * @param {Object|null} emojiContext - 当前卡片表情渲染上下文
 * @returns {String} HTML 字符串
 */
function renderVideoContent(data, emojiContext = null) {
    const info = data.data;
    const owner = info.owner || {};
    const ownerFace = owner.face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';
    const ownerName = owner.name || 'Unknown';
    const verifyType = Number(owner.official_verify?.type);
    const verifyBadgeHtml = renderVerifyBadge(verifyType, 'author-verify-badge--video');
    const durationStr = info.duration ? ` • 时长: ${formatDuration(info.duration)}` : '';
    const resolvedTitle = resolvePlainTextContent(info.title)
    const resolvedDesc = resolvePlainTextContent(info.desc)
    return `
        <div class="cover-container" data-layout-key="cover">
            <img class="cover video" src="${info.pic}" />
        </div>
        <div class="content" data-layout-key="content">
            <div class="header" data-layout-key="header">
                <div class="header-left">
                    <div class="avatar-wrapper" data-layout-key="avatar">
                        <img class="avatar no-frame" src="${ownerFace}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                        ${verifyBadgeHtml}
                    </div>
                    <div class="user-info">
                        <span class="user-name" data-layout-key="authorName">${escapeHtml(ownerName)}</span>
                        <span class="pub-time" data-layout-key="pubTime">${formatPubTime(info.pubdate)}${durationStr}</span>
                    </div>
                </div>
            </div>
            <div class="title" data-layout-key="title">${parseRichText(resolvedTitle.richTextNodes, resolvedTitle.text, emojiContext)}</div>
            <div class="stats video-stats" data-layout-key="stats">
                <span class="stat-item">${ICONS.view} ${formatNumber(info.view?.count || info.stat?.view)}</span>
                <span class="stat-item">${ICONS.like} ${formatNumber(info.like || info.stat?.like)}</span>
                <span class="stat-item">${ICONS.comment} ${formatNumber(info.reply || info.stat?.reply)}</span>
            </div>
            ${resolvedDesc.text ? `<div class="text-content" data-layout-key="text">${parseRichText(resolvedDesc.richTextNodes, resolvedDesc.text, emojiContext)}</div>` : ''}
        </div>
    `;
}

module.exports = { renderVideoContent };
