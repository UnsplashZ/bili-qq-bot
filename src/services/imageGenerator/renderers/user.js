const { escapeHtml, formatNumber } = require('../core/formatters');

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
             mediaHtml = `<div style="display: flex; gap: 12px; margin-top: 20px; overflow: hidden; height: 180px;">
                ${dynImages.slice(0, 3).map(src => `<img src="${src}" style="height: 180px; width: 180px; object-fit: cover; border-radius: 8px;">`).join('')}
             </div>`;
        } else if (dynVideo) {
             mediaHtml = `<div style="margin-top: 20px; display: flex; gap: 16px; background: var(--color-soft-bg); border-radius: 12px; padding: 12px; align-items: center;">
                <img src="${dynVideo.cover}" style="height: 90px; width: 144px; object-fit: cover; border-radius: 8px;">
                <div style="flex: 1; font-size: 20px; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.4;">${dynVideo.title}</div>
             </div>`;
        }

        dynamicHtml = `
            <div style="margin-top: 35px; border-top: 1px solid var(--color-border); padding-top: 25px; text-align: left;">
                <div style="font-size: 20px; color: var(--color-subtext); margin-bottom: 12px; font-weight: bold;">最近动态</div>
                <div style="font-size: 24px; color: var(--color-text); line-height: 1.6; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;">${escapeHtml(dynText)}</div>
                ${mediaHtml}
            </div>
        `;
    }

    return `
        <div class="content">
            <div class="header" style="display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 10px;">
                <div class="avatar-wrapper" style="width: 150px; height: 150px; margin-bottom: 20px; box-sizing: content-box; ${pendantImage ? 'padding-top: 85px;' : ''}">
                    <img class="avatar ${pendantImage ? '' : 'no-frame'}" src="${face}" style="width: 150px; height: 150px; border-width: 4px;">
                    ${pendantImage ? `<img class="avatar-frame" src="${pendantImage}" style="width: 160%; height: 160%;">` : ''}
                </div>
                <div class="user-info" style="width: 100%;">
                    <div class="user-name" style="font-size: 36px; font-weight: bold; color: var(--color-text); display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap;">
                        ${name}
                        <span class="user-level lv${level}">Lv${level}</span>
                        ${vipLabel ? `<span style="font-size: 16px; background: var(--color-primary); color: white; padding: 4px 8px; border-radius: 4px; vertical-align: middle;">${vipLabel}</span>` : ''}
                    </div>
                    ${show_id ? `<div style="text-align: center; font-size: 16px; color: var(--color-subtext); margin-top: 4px; font-family: monospace;">UID: ${info.uid}</div>` : ''}
                    ${medalName ? `
                    <div style="margin-top: 12px; display: flex; align-items: center; justify-content: center;">
                        <div style="display: inline-flex; border: 1px solid var(--color-subtext); border-radius: 4px; overflow: hidden;">
                            <span style="background: var(--color-subtext); color: var(--color-card-bg); padding: 2px 6px; font-size: 16px; font-weight: bold;">${medalName}</span>
                            <span style="background: var(--color-card-bg); color: var(--color-subtext); padding: 2px 6px; font-size: 16px;">${medalLevel}</span>
                        </div>
                    </div>` : ''}
                    ${sign ? `<div class="text-content" style="text-align: center; margin-top: 16px; color: var(--color-subtext); font-size: 18px; line-height: 1.5; padding: 0 20px;">"${sign}"</div>` : ''}
                </div>
            </div>

            <div class="stats" style="display: flex; justify-content: center; gap: 40px; margin: 30px auto 0 auto; padding: 20px 40px; background: var(--color-soft-bg); border-radius: 12px; width: fit-content;">
                <div style="text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: var(--color-text); margin-bottom: 4px;">${formatNumber(follower)}</div>
                    <div style="font-size: 16px; color: var(--color-subtext);">粉丝</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: var(--color-text); margin-bottom: 4px;">${formatNumber(following)}</div>
                    <div style="font-size: 16px; color: var(--color-subtext);">关注</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: var(--color-text); margin-bottom: 4px;">${formatNumber(info.likes || 0)}</div>
                    <div style="font-size: 16px; color: var(--color-subtext);">获赞</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 24px; font-weight: bold; color: var(--color-text); margin-bottom: 4px;">${formatNumber(info.archive_view || 0)}</div>
                    <div style="font-size: 16px; color: var(--color-subtext);">播放</div>
                </div>
            </div>
            ${dynamicHtml}
        </div>
    `;
}

module.exports = { renderUserContent };
