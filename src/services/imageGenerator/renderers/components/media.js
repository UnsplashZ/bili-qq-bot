const { formatNumber } = require('../../core/formatters');
const ICONS = require('../icons');

/**
 * 渲染媒体HTML (图片、视频卡片)
 * @param {Array} images - 图片URL数组
 * @param {Object} videoCard - 视频卡片对象
 * @param {Boolean} isOrig - 是否在转发动态中
 * @returns {String} HTML 字符串
 */
function renderMediaHtml(images, videoCard, isOrig) {
    if (images.length === 1) {
         const style = isOrig
            ? 'width: 100%; height: auto; object-fit: contain; max-height: 1000px; margin-top: 10px;'
            : 'width: 100%; height: auto; margin-top: 20px;';
         const cls = isOrig ? 'single-image' : 'dynamic-image';
         return `<img class="${cls}" src="${images[0]}" style="${style}">`;
    } else if (images.length > 1) {
         return `
            <div class="images-grid" ${isOrig ? 'style="margin-top:10px;"' : ''}>
                ${images.map(src => `<img src="${src}" style="width: 100%; height: 100%; object-fit: cover; aspect-ratio: 1/1; ${(!isOrig) ? 'margin-top: 10px;' : ''}">`).join('')}
            </div>`;
    } else if (videoCard) {
        if (videoCard.isLiveRcmd) {
             return `
                <div style="margin-top:20px; border:1px solid #eee; border-radius:8px; overflow:hidden;">
                    <div class="cover-container">
                        <img src="${videoCard.cover}" style="width: 100%; aspect-ratio:16/9; object-fit: cover; max-height: 800px;">
                        ${videoCard.liveBadge ? `<div style="position:absolute; top:10px; right:10px;">${videoCard.liveBadge}</div>` : ''}
                    </div>
                    <div style="padding:15px; background:#f9f9f9;">
                        <div style="font-weight:bold; font-size:18px; margin-bottom:8px;">${videoCard.title}</div>
                        <div style="color:#666; font-size:14px; display:flex; gap:15px;">
                            <span>${videoCard.area}</span>
                            <span>${videoCard.watched}</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            const duration = videoCard.duration_text || '';
            const play = isOrig
                ? formatNumber(videoCard.stat?.play || videoCard.stat?.view)
                : (videoCard.stat?.play || '');
            const danmaku = isOrig
                ? formatNumber(videoCard.stat?.danmaku)
                : (videoCard.stat?.danmaku || '');

            return `
                <div class="video-card-inline">
                    <div class="cover-container">
                        <img src="${videoCard.cover}" style="width: 100%; aspect-ratio:16/9; object-fit: cover; max-height: 800px;">
                        ${duration ? `<span class="duration-badge">${duration}</span>` : ''}
                    </div>
                    <div class="video-card-content">
                        <div class="video-card-title">${videoCard.title}</div>
                        ${(play || danmaku) ? `
                        <div class="stat-inline-container">
                            ${play ? `<span class="stat-inline">${ICONS.view} ${play}</span>` : ''}
                            ${danmaku ? `<span class="stat-inline">${ICONS.comment} ${danmaku}</span>` : ''}
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }
    }
    return '';
}

module.exports = {
    renderMediaHtml
};
