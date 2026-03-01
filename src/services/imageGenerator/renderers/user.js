const { escapeHtml, formatNumber } = require('../core/formatters');
const { renderVerifyBadge } = require('./components/verifyBadge');

/**
 * 渲染用户主页内容
 * @param {Object} data - 用户数据
 * @param {Boolean} show_id - 是否显示UID
 * @returns {String} HTML 字符串
 */
function renderUserContent(data, show_id) {
    const info = data.data;
    const face = info.face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';
    const name = info.name || 'Unknown';
    const sign = info.sign || '';
    const pendant = info.pendant || {};
    const pendantImage = pendant.image || '';
    const follower = info.relation ? info.relation.follower : 0;
    const following = info.relation ? info.relation.following : 0;
    const level = info.level || 0;
    const isVip = info.vip && info.vip.status === 1;
    const vipLabel = info.vip && info.vip.label && info.vip.label.text ? info.vip.label.text : (isVip ? '大会员' : '');
    const medalName = info.fans_medal && info.fans_medal.medal ? info.fans_medal.medal.medal_name : '';
    const medalLevel = info.fans_medal && info.fans_medal.medal ? info.fans_medal.medal.level : 0;
    const dynamicVerifyType = Number(info.dynamic?.modules?.module_author?.official_verify?.type)
    const hasFrame = !!pendantImage
    const verifyBadgeHtml = renderVerifyBadge(
        dynamicVerifyType,
        `author-verify-badge--user ${hasFrame ? 'author-verify-badge--with-frame' : 'author-verify-badge--no-frame'}`
    )
    const userAvatarWrapperClass = hasFrame
        ? 'avatar-wrapper avatar-wrapper--user avatar-wrapper--with-frame'
        : 'avatar-wrapper avatar-wrapper--user avatar-wrapper--no-frame'

    let dynamicHtml = '';
    if (info.dynamic) {
        const dyn = info.dynamic;
        const modules = dyn.modules || {};
        const dynDesc = modules.module_dynamic ? modules.module_dynamic.desc : null;
        const dynMajor = modules.module_dynamic ? modules.module_dynamic.major : null;

        let dynText = dynDesc ? dynDesc.text : '';
        if (!dynText && dynMajor) {
            if (dynMajor.opus && dynMajor.opus.summary) {
                 dynText = dynMajor.opus.summary.text || (dynMajor.opus.summary.rich_text_nodes || []).map(n => n.text).join('');
            } else if (dynMajor.draw && dynMajor.draw.items) {
                 // fallback
            }
        }

        let dynImages = [];
        let dynVideo = null;

        if (dynMajor) {
            if (dynMajor.draw && dynMajor.draw.items) {
                dynImages = dynMajor.draw.items.map(i => i.src);
            } else if (dynMajor.opus && dynMajor.opus.pics) {
                dynImages = dynMajor.opus.pics.map(i => i.url);
            } else if (dynMajor.archive) {
                dynVideo = dynMajor.archive;
                if (!dynText) dynText = dynVideo.desc;
            }
        }

        let mediaHtml = '';
        if (dynImages.length > 0) {
             mediaHtml = `<div class="user-dynamic-images">
                ${dynImages.slice(0, 3).map(src => `<img src="${src}" class="user-dynamic-image">`).join('')}
             </div>`;
        } else if (dynVideo) {
             mediaHtml = `<div class="user-dynamic-video">
                <img src="${dynVideo.cover}" class="user-dynamic-video-cover">
                <div class="user-dynamic-video-title">${dynVideo.title}</div>
             </div>`;
        }

        dynamicHtml = `
            <div class="user-dynamic-section">
                <div class="user-dynamic-title">最近动态</div>
                <div class="user-dynamic-text">${escapeHtml(dynText)}</div>
                ${mediaHtml}
            </div>
        `;
    }

    return `
        <div class="content">
            <div class="header user-header">
                <div class="${userAvatarWrapperClass}">
                    <img class="avatar avatar--user ${pendantImage ? '' : 'no-frame'}" src="${face}">
                    ${pendantImage ? `<img class="avatar-frame avatar-frame--user" src="${pendantImage}">` : ''}
                    ${verifyBadgeHtml}
                </div>
                <div class="user-info user-info--profile">
                    <div class="user-name user-name--profile">
                        ${name}
                        <span class="user-level lv${level}">Lv${level}</span>
                        ${vipLabel ? `<span class="user-vip-label">${vipLabel}</span>` : ''}
                    </div>
                    ${show_id ? `<div class="user-id-text">UID: ${info.uid}</div>` : ''}
                    ${medalName ? `
                    <div class="user-medal">
                        <div class="user-medal-badge">
                            <span class="user-medal-name">${medalName}</span>
                            <span class="user-medal-level">${medalLevel}</span>
                        </div>
                    </div>` : ''}
                    ${sign ? `<div class="text-content user-sign">"${sign}"</div>` : ''}
                </div>
            </div>

            <div class="stats user-stats">
                <div class="user-stat-item">
                    <div class="user-stat-value">${formatNumber(follower)}</div>
                    <div class="user-stat-label">粉丝</div>
                </div>
                <div class="user-stat-item">
                    <div class="user-stat-value">${formatNumber(following)}</div>
                    <div class="user-stat-label">关注</div>
                </div>
                <div class="user-stat-item">
                    <div class="user-stat-value">${formatNumber(info.likes || 0)}</div>
                    <div class="user-stat-label">获赞</div>
                </div>
                <div class="user-stat-item">
                    <div class="user-stat-value">${formatNumber(info.archive_view || 0)}</div>
                    <div class="user-stat-label">播放</div>
                </div>
            </div>
            ${dynamicHtml}
        </div>
    `;
}

module.exports = { renderUserContent };
