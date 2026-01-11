const { formatPubTime, formatNumber } = require('../core/formatters');
const { parseRichText } = require('./components/richtext');
const { renderVoteCard, getVoteFromModules } = require('./components/vote');
const { renderMediaHtml } = require('./components/media');
const ICONS = require('./icons');
const logger = require('../../../utils/logger');

/**
 * 渲染转发的原动态内容
 * @param {Object} origItemRaw - 原动态数据
 * @returns {String} HTML 字符串
 */
function renderOrigContent(origItemRaw) {
    const oitem = origItemRaw.item ? origItemRaw.item : origItemRaw;
    const omodules = oitem.modules || {};
    const o_author = omodules.module_author || {};
    const o_dynamic = omodules.module_dynamic || {};

    let o_text = "";
    let o_title = "";
    let o_richTextNodes = null;
    if (o_dynamic.desc) {
        o_text = o_dynamic.desc.text || "";
        o_richTextNodes = o_dynamic.desc.rich_text_nodes;
    } else if (o_dynamic.major?.opus) {
        if (o_dynamic.major.opus.summary) {
            o_text = o_dynamic.major.opus.summary.text || "";
            o_richTextNodes = o_dynamic.major.opus.summary.rich_text_nodes;
        }
        o_title = o_dynamic.major.opus.title || "";
    }
    o_text = parseRichText(o_richTextNodes, o_text);

    let o_images = [];
    let o_videoCard = null;
    if (o_dynamic.major?.draw?.items) {
        o_images = o_dynamic.major.draw.items.map(i => i.src);
    } else if (o_dynamic.major?.opus?.pics) {
        o_images = o_dynamic.major.opus.pics.map(i => i.url);
    } else if (o_dynamic.major?.archive) {
        o_videoCard = o_dynamic.major.archive;
        if (!o_text) o_text = o_videoCard.desc;
    }

    const o_mediaHtml = renderMediaHtml(o_images, o_videoCard, true);
    const o_voteObj = getVoteFromModules(omodules);
    const o_voteHtml = renderVoteCard(o_voteObj);
    const o_name = o_author.name || 'Unknown';
    const o_face = o_author.face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';

    return `
        <div class="orig-card">
            <div class="orig-header">
                <img class="orig-author-avatar" src="${o_face}">
                <span class="orig-author-name">${o_name}</span>
            </div>
            <div class="orig-content">
                ${o_title ? `<div class="orig-title">${o_title}</div>` : ''}
                ${o_text ? `<div class="orig-text truncated">${o_text}</div>` : ''}
                ${o_voteHtml}
                ${o_mediaHtml}
            </div>
        </div>
    `;
}

/**
 * 渲染动态内容
 * @param {Object} data - 动态数据
 * @returns {String} HTML 字符串
 */
function renderDynamicContent(data) {
    let modules = {};
    let item = {};
    if (data.data.item) {
        item = data.data.item;
        modules = item.modules;
    } else {
        item = data.data;
        modules = item.modules || {};
    }

    const module_author = modules.module_author || {};
    const module_dynamic = modules.module_dynamic || {};
    const module_stat = modules.module_stat || {};

    const authorName = module_author.name || 'Unknown';
    const authorFace = module_author.face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';
    const pubTime = formatPubTime(data.data.pub_ts) || formatPubTime(module_author.pub_ts) || module_author.pub_time || '';

    // Author decoration
    const decorationCard = module_author.decoration_card || {};
    const fanInfo = decorationCard.fan || {};
    const authorInfo = item.author || data.data.author || {};
    const authorLevel = authorInfo.level || 0;
    const pendantUrl = authorInfo.pendant_url || (module_author.pendant && module_author.pendant.image) || '';
    const cardUrl = authorInfo.card_url || (decorationCard && decorationCard.card_url) || '';
    const fanNumber = fanInfo.num_desc || '';
    const fanColor = authorInfo.fan_color || fanInfo.color || '#555';
    const serial = (fanNumber || authorInfo.card_number || null);

    let text = "";
    let title = "";
    let richTextNodes = null;
    let liveRcmdInfo = null;

    if (item.type === 'DYNAMIC_TYPE_LIVE_RCMD' && module_dynamic.major?.live_rcmd?.content) {
        try {
            const contentStr = module_dynamic.major.live_rcmd.content;
            const contentJson = JSON.parse(contentStr);
            if (contentJson.live_play_info) {
                liveRcmdInfo = contentJson.live_play_info;
            }
        } catch (e) {
            logger.error('Failed to parse live_rcmd content', e);
        }
    }

    if (module_dynamic.desc) {
        text = module_dynamic.desc.text || "";
        richTextNodes = module_dynamic.desc.rich_text_nodes;
    } else if (module_dynamic.major?.opus) {
         if (module_dynamic.major.opus.summary) {
             text = module_dynamic.major.opus.summary.text || "";
             richTextNodes = module_dynamic.major.opus.summary.rich_text_nodes;
         }
         title = module_dynamic.major.opus.title || "";
    }

    text = parseRichText(richTextNodes, text);
    const voteObj = getVoteFromModules(modules);
    const voteHtml = renderVoteCard(voteObj);

    let images = [];
    let videoCard = null;

    if (module_dynamic.major?.draw?.items) {
        images = module_dynamic.major.draw.items.map(i => i.src);
    } else if (module_dynamic.major?.opus?.pics) {
         images = module_dynamic.major.opus.pics.map(i => i.url);
    } else if (module_dynamic.major?.archive) {
         videoCard = module_dynamic.major.archive;
         if(!text) text = videoCard.desc;
    } else if (liveRcmdInfo) {
         const isLive = liveRcmdInfo.live_status === 1;
         const liveBadge = isLive
            ? `<span class="live-badge-status live-on">LIVE</span>`
            : `<span class="live-badge-status live-off">OFFLINE</span>`;

         videoCard = {
            cover: liveRcmdInfo.cover,
            title: liveRcmdInfo.title,
            isLiveRcmd: true,
            liveBadge: liveBadge,
            area: `${liveRcmdInfo.parent_area_name} · ${liveRcmdInfo.area_name}`,
            watched: liveRcmdInfo.watched_show?.text_large || ''
         };
    }

    const mediaHtml = renderMediaHtml(images, videoCard, false);

    let origHtml = '';
    if (item.orig) {
        origHtml = renderOrigContent(item.orig);
    }

    return `
        <div class="content">
            <div class="header">
                <div class="header-left">
                    <div class="avatar-wrapper">
                        <img class="avatar ${pendantUrl ? 'no-border' : 'no-frame'}" src="${authorFace}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                        ${pendantUrl ? `<img class="avatar-frame" src="${pendantUrl}" />` : ''}
                    </div>
                    <div class="user-info">
                        <span class="user-name">${authorName} ${authorLevel ? `<span class="user-level lv${authorLevel}">Lv${authorLevel}</span>` : ''}</span>
                        <span class="pub-time">${pubTime}</span>
                    </div>
                </div>
                <div class="header-right" style="display:flex; align-items:center; gap:12px;">
                    ${cardUrl ? `
                        <div class="decoration-card-wrapper">
                            <img class="decoration-card" src="${cardUrl}" />
                            ${serial ? `<span class="serial-badge" style="color: ${fanColor};">No.${serial}</span>` : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
            ${title ? `<div class="title">${title}</div>` : ''}
            <div class="text-content truncated">${text}</div>
            ${voteHtml}
            ${origHtml}
            ${mediaHtml}
            <div class="action-bar">
                 <div class="action-item">${ICONS.share} ${formatNumber(module_stat.forward?.count)}</div>
                 <div class="action-item">${ICONS.comment} ${formatNumber(module_stat.comment?.count)}</div>
                 <div class="action-item">${ICONS.like} ${formatNumber(module_stat.like?.count)}</div>
            </div>
        </div>
    `;
}

module.exports = { renderDynamicContent, renderOrigContent };
