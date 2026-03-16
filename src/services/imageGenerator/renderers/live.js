const { escapeHtml } = require('../core/formatters');
const { parseRichText } = require('./components/richtext');
const { resolvePlainTextContent } = require('./components/contentNodes');
const ICONS = require('./icons');

/**
 * 渲染直播间内容
 * @param {Object} data - 直播间数据
 * @param {Object|null} emojiContext - 当前卡片表情渲染上下文
 * @returns {String} HTML 字符串
 */
function renderLiveContent(data, emojiContext = null) {
    const info = data.data;
    const roomInfo = info.room_info || {};
    const anchorInfo = info.anchor_info || {};
    const watched = info.watched_show || {};
    const resolvedTitle = resolvePlainTextContent(roomInfo.title)
    const resolvedParentArea = resolvePlainTextContent(roomInfo.parent_area_name)
    const resolvedArea = resolvePlainTextContent(roomInfo.area_name)

    const isLive = roomInfo.live_status === 1;
    const liveBadge = isLive
        ? `<span class="live-badge-status live-badge-lg live-on">LIVE</span>`
        : `<span class="live-badge-status live-badge-lg live-off">OFFLINE</span>`;

    return `
        <div class="cover-container">
            <img class="cover live" src="${roomInfo.cover}" />
        </div>
        <div class="content">
            <div class="header">
                <div class="header-left">
                    <div class="avatar-wrapper">
                        <img class="avatar no-frame" src="${anchorInfo.base_info?.face}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                    </div>
                    <div class="user-info">
                        <div class="live-header-name-row">
                            <span class="user-name">${escapeHtml(anchorInfo.base_info?.uname || 'Unknown')}</span>
                            ${liveBadge}
                        </div>
                        <span class="pub-time">直播间: ${roomInfo.room_id}</span>
                    </div>
                </div>
            </div>
            <div class="title">${parseRichText(resolvedTitle.richTextNodes, resolvedTitle.text, emojiContext)}</div>
            <div class="stats">
                <span class="stat-item">${ICONS.fire} ${watched.text_large || watched.num || 0}</span>
                <span class="stat-item">${ICONS.star} ${parseRichText(resolvedParentArea.richTextNodes, resolvedParentArea.text, emojiContext)} · ${parseRichText(resolvedArea.richTextNodes, resolvedArea.text, emojiContext)}</span>
            </div>
        </div>
    `;
}

module.exports = { renderLiveContent };
