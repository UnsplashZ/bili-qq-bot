const { escapeHtml, formatNumber } = require('../core/formatters');
const { collectDynamicImages, resolveDynamicContent } = require('./components/contentNodes');
const { parseRichText } = require('./components/richtext');
const { renderDynamicSupplementalCards } = require('./components/dynamicSupplementalCards');
const { renderEmbeddedResourceCard } = require('./components/media');
const { resolveDynamicEmbeddedResourceCard } = require('./components/embeddedResourceResolver');
const { renderVerifyBadge } = require('./components/verifyBadge');

/**
 * 渲染用户主页内容
 * @param {Object} data - 用户数据
 * @param {Boolean} show_id - 是否显示UID
 * @param {Object|null} emojiContext - 当前卡片表情渲染上下文
 * @returns {String} HTML 字符串
 */
function renderUserContent(data, show_id, emojiContext = null) {
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
        const dynamicModule = modules.module_dynamic || {};
        const dynMajor = dynamicModule.major || null;

        let dynImages = [];
        let dynVideo = null;

        if (dynMajor) {
            if (dynMajor.draw && dynMajor.draw.items) {
                dynImages = dynMajor.draw.items.map(i => i.src);
            } else if (dynMajor.opus && dynMajor.opus.pics) {
                dynImages = dynMajor.opus.pics.map(i => i.url);
            } else if (dynMajor.archive) {
                dynVideo = dynMajor.archive;
            }
        }

        const resolvedDynamic = resolveDynamicContent(
            dynamicModule,
            collectDynamicImages(dynamicModule).length > 0
        )
        let dynText = resolvedDynamic.text
        if (!dynText && dynVideo) dynText = dynVideo.desc || ''

        let mediaHtml = '';
        if (dynImages.length > 0) {
             mediaHtml = `<div class="user-dynamic-images" data-layout-key="dynamicMedia">
                ${dynImages.slice(0, 3).map(src => `<img src="${src}" class="user-dynamic-image">`).join('')}
             </div>`;
        } else if (dynVideo) {
             mediaHtml = `<div class="user-dynamic-video" data-layout-key="dynamicMedia">
                <img src="${dynVideo.cover}" class="user-dynamic-video-cover">
                <div class="user-dynamic-video-title">${dynVideo.title}</div>
             </div>`;
        }

        const dynContentHtml = parseRichText(resolvedDynamic.richTextNodes, dynText, emojiContext)
        const embeddedResourceHtml = renderEmbeddedResourceCard(
            resolveDynamicEmbeddedResourceCard(dynamicModule),
            { emojiContext }
        )
        const supplementalHtml = renderDynamicSupplementalCards(modules, {
            emojiContext
        })
        const supplementalCardsHtml = [embeddedResourceHtml, supplementalHtml].filter(Boolean).join('')

        dynamicHtml = `
            <div class="user-dynamic-section" data-layout-key="dynamicSection">
                <div class="user-dynamic-title">最近动态</div>
                <div class="user-dynamic-text" data-layout-key="dynamicText">${dynContentHtml}</div>
                ${mediaHtml}
                ${supplementalCardsHtml ? `<div data-layout-key="supplementalCards">${supplementalCardsHtml}</div>` : ''}
            </div>
        `;
    }

    return `
        <div class="content" data-layout-key="content">
            <div class="header user-header" data-layout-key="header">
                <div class="${userAvatarWrapperClass}" data-layout-key="avatar">
                    <img class="avatar avatar--user ${pendantImage ? '' : 'no-frame'}" src="${face}">
                    ${pendantImage ? `<img class="avatar-frame avatar-frame--user" src="${pendantImage}">` : ''}
                    ${verifyBadgeHtml}
                </div>
                <div class="user-info user-info--profile">
                    <div class="user-name user-name--profile" data-layout-key="authorName">
                        ${name}
                        <span class="user-level lv${level}">Lv${level}</span>
                        ${vipLabel ? `<span class="user-vip-label">${vipLabel}</span>` : ''}
                    </div>
                    ${show_id ? `<div class="user-id-text" data-layout-key="uid">UID: ${info.uid}</div>` : ''}
                    ${medalName ? `
                    <div class="user-medal" data-layout-key="medal">
                        <div class="user-medal-badge">
                            <span class="user-medal-name">${medalName}</span>
                            <span class="user-medal-level">${medalLevel}</span>
                        </div>
                    </div>` : ''}
                    ${sign ? `<div class="text-content user-sign" data-layout-key="signature">"${sign}"</div>` : ''}
                </div>
            </div>

            <div class="stats user-stats" data-layout-key="stats">
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
