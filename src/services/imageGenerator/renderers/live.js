const { escapeHtml } = require('../core/formatters');
const ICONS = require('./icons');

/**
 * 渲染直播间内容
 * @param {Object} data - 直播间数据
 * @returns {String} HTML 字符串
 */
function renderLiveContent(data) {
    const info = data.data;
    const roomInfo = info.room_info || {};
    const anchorInfo = info.anchor_info || {};
    const watched = info.watched_show || {};

    const isLive = roomInfo.live_status === 1;
    const liveBadge = isLive
        ? `<span class="live-badge-status live-on" style="font-size: 20px; padding: 6px 12px; margin-left: 10px;">LIVE</span>`
        : `<span class="live-badge-status live-off" style="font-size: 20px; padding: 6px 12px; margin-left: 10px;">OFFLINE</span>`;

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
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="user-name">${escapeHtml(anchorInfo.base_info?.uname || 'Unknown')}</span>
                            ${liveBadge}
                        </div>
                        <span class="pub-time">直播间: ${roomInfo.room_id}</span>
                    </div>
                </div>
            </div>
            <div class="title">${escapeHtml(roomInfo.title)}</div>
            <div class="stats">
                <span class="stat-item">${ICONS.fire} ${watched.text_large || watched.num || 0}</span>
                <span class="stat-item">${ICONS.star} ${escapeHtml(roomInfo.parent_area_name || '')} · ${escapeHtml(roomInfo.area_name || '')}</span>
            </div>
        </div>
    `;
}

module.exports = { renderLiveContent };
