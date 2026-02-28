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
         const cls = isOrig ? 'single-image is-orig' : 'dynamic-image';
         return `<img class="${cls}" src="${images[0]}">`;
    } else if (images.length > 1) {
         const maxImages = 9;
         const displayImages = images.slice(0, maxImages);
         const count = displayImages.length;
         // 2, 4 use 2 columns; 3, 5+ use 3 columns (default)
         const gridClass = (count === 2 || count === 4) ? 'cols-2' : '';
         return `
            <div class="images-grid ${gridClass} ${isOrig ? 'is-orig' : ''}">
                ${displayImages.map(src => `<img src="${src}">`).join('')}
            </div>`;
    } else if (videoCard) {
        if (videoCard.isLiveRcmd) {
             return `
                <div class="live-rcmd-card">
                    <div class="cover-container">
                        <img class="live-rcmd-cover" src="${videoCard.cover}">
                        ${videoCard.liveBadge ? `<div class="live-rcmd-badge-wrap">${videoCard.liveBadge}</div>` : ''}
                    </div>
                    <div class="live-rcmd-content">
                        <div class="live-rcmd-title">${videoCard.title}</div>
                        <div class="live-rcmd-meta">
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
                        <img class="video-card-cover" src="${videoCard.cover}">
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
