const { formatPubTime, formatNumber, escapeHtml } = require('../core/formatters');
const { parseRichText } = require('./components/richtext');
const { renderVoteCard, getVoteFromModules } = require('./components/vote');
const { renderMediaHtml } = require('./components/media');
const { renderVerifyBadge } = require('./components/verifyBadge');
const ICONS = require('./icons');
const logger = require('../../../utils/logger');

function normalizePlainText(text) {
    if (!text) return ''
    return String(text)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\u200b/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function stripImagePlaceholders(text, hasImages) {
    const normalized = normalizePlainText(text)
    if (!normalized) return ''
    if (!hasImages) return normalized
    return normalized
        .replace(/\s*\[图片\]\s*/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function normalizeRichTextNodes(nodes, hasImages) {
    if (!Array.isArray(nodes) || nodes.length === 0 || !hasImages) return nodes
    return nodes.map(node => {
        if (!node || typeof node !== 'object' || typeof node.text !== 'string') return node
        const cleanedText = node.text
            .replace(/\[图片\]/g, '')

        if (cleanedText === node.text) return node

        const nextNode = { ...node, text: cleanedText }
        if (typeof node.orig_text === 'string') {
            nextNode.orig_text = node.orig_text
                .replace(/\[图片\]/g, '')
        }
        return nextNode
    })
}

function normalizeForNodeCompare(text) {
    return normalizePlainText(text)
        .replace(/\[[^\]]+\]/g, '')
        .replace(/\s+/g, '')
}

function canBorrowSummaryNodes(descText, summaryText) {
    const normalizedDesc = normalizeForNodeCompare(descText)
    const normalizedSummary = normalizeForNodeCompare(summaryText)
    if (!normalizedDesc || !normalizedSummary) return false
    return normalizedDesc === normalizedSummary
}

function buildNodesFromSummary(descText, summaryNodes) {
    if (!Array.isArray(summaryNodes)) return summaryNodes
    const copied = summaryNodes.map(node => {
        if (!node || typeof node !== 'object') return node
        return { ...node }
    })

    const textNodeIndexes = []
    copied.forEach((node, index) => {
        if (node?.type === 'RICH_TEXT_NODE_TYPE_TEXT') textNodeIndexes.push(index)
    })

    // Only safe when summary has exactly one text carrier node.
    // Multiple text nodes can drift from desc segmentation.
    if (textNodeIndexes.length !== 1) return null

    const textNodeIndex = textNodeIndexes[0]
    const target = copied[textNodeIndex] || {}
    copied[textNodeIndex] = {
        ...target,
        text: descText,
        orig_text: descText
    }

    return copied
}

function injectTopicNodeIfNeeded(nodes, topic, plainText) {
    if (!Array.isArray(nodes) || nodes.length === 0) return nodes
    if (!topic || !topic.name) return nodes
    if (nodes.some(node => node?.type === 'RICH_TEXT_NODE_TYPE_TOPIC')) return nodes

    const topicBase = `#${topic.name}`
    const topicFull = `${topicBase}#`
    const jumpUrl = topic.jump_url ||
        (topic.id ? `https://www.bilibili.com/v/topic/detail/?topic_id=${topic.id}` : '')

    const nextNodes = []
    let inserted = false

    for (const node of nodes) {
        if (
            inserted ||
            !node ||
            node.type !== 'RICH_TEXT_NODE_TYPE_TEXT' ||
            typeof node.text !== 'string'
        ) {
            nextNodes.push(node)
            continue
        }

        let matched = ''
        let startIndex = node.text.indexOf(topicFull)
        if (startIndex >= 0) {
            matched = topicFull
        } else {
            startIndex = node.text.indexOf(topicBase)
            if (startIndex >= 0) matched = topicBase
        }

        if (startIndex < 0 || !matched) {
            nextNodes.push(node)
            continue
        }

        const beforeText = node.text.slice(0, startIndex)
        const afterText = node.text.slice(startIndex + matched.length)

        if (beforeText) {
            nextNodes.push({
                ...node,
                text: beforeText,
                orig_text: beforeText
            })
        }

        nextNodes.push({
            type: 'RICH_TEXT_NODE_TYPE_TOPIC',
            text: matched,
            orig_text: matched,
            jump_url: jumpUrl
        })

        if (afterText) {
            nextNodes.push({
                ...node,
                text: afterText,
                orig_text: afterText
            })
        }

        inserted = true
    }

    if (inserted) return nextNodes

    // 无法安全拆分时保持原节点，避免重复渲染话题
    if (typeof plainText === 'string' && (plainText.includes(topicBase) || plainText.includes(topicFull))) {
        return nodes
    }
    return nodes
}

function toSafeNumber(value) {
    const num = Number(value)
    return Number.isFinite(num) ? num : 0
}

function normalizeDynamicImageItem(item) {
    if (!item || typeof item !== 'object') return null
    const url = item.url || item.src || ''
    if (!url) return null
    return {
        url,
        width: toSafeNumber(item.width),
        height: toSafeNumber(item.height),
        liveUrl: item.live_url || item.liveUrl || ''
    }
}

function collectDynamicImages(dynamicModule) {
    if (dynamicModule.major?.draw?.items) {
        return dynamicModule.major.draw.items
            .map(normalizeDynamicImageItem)
            .filter(Boolean)
    }
    if (dynamicModule.major?.opus?.pics) {
        return dynamicModule.major.opus.pics
            .map(normalizeDynamicImageItem)
            .filter(Boolean)
    }
    return []
}

function resolveDynamicText(dynamicModule, hasImages) {
    let text = ''
    let richTextNodes = null
    let source = 'empty'

    if (dynamicModule.desc) {
        text = dynamicModule.desc.text || ''
        richTextNodes = dynamicModule.desc.rich_text_nodes
        source = 'desc'
    }

    // desc 有正文但缺少 rich nodes 时，借用 summary 的富文本节点（用于恢复 emoji 等）
    if (
        source === 'desc' &&
        normalizePlainText(text) &&
        (!Array.isArray(richTextNodes) || richTextNodes.length === 0) &&
        dynamicModule.major?.opus?.summary
    ) {
        const summary = dynamicModule.major.opus.summary
        const summaryNodes = summary.rich_text_nodes
        if (
            Array.isArray(summaryNodes) &&
            summaryNodes.length > 0 &&
            summaryNodes.some(node => node?.type && node.type !== 'RICH_TEXT_NODE_TYPE_TEXT') &&
            canBorrowSummaryNodes(text, summary.text || '')
        ) {
            const borrowedNodes = buildNodesFromSummary(text, summaryNodes)
            if (Array.isArray(borrowedNodes) && borrowedNodes.length > 0) {
                richTextNodes = borrowedNodes
                source = 'desc_with_summary_nodes'
            }
        }
    }

    if (!normalizePlainText(text) && dynamicModule.major?.opus?.summary) {
        text = dynamicModule.major.opus.summary.text || ''
        richTextNodes = dynamicModule.major.opus.summary.rich_text_nodes
        source = 'opus_summary'
    }

    richTextNodes = injectTopicNodeIfNeeded(richTextNodes, dynamicModule.topic, text)

    return {
        text: stripImagePlaceholders(text, hasImages),
        richTextNodes: normalizeRichTextNodes(richTextNodes, hasImages),
        title: dynamicModule.major?.opus?.title || '',
        source
    }
}

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

    const o_images = collectDynamicImages(o_dynamic);
    const resolvedOrig = resolveDynamicText(o_dynamic, o_images.length > 0);
    const o_text = parseRichText(resolvedOrig.richTextNodes, resolvedOrig.text);
    const o_title = resolvedOrig.title;

    let o_videoCard = null;
    if (o_dynamic.major?.archive) {
        o_videoCard = o_dynamic.major.archive;
        // if (!o_text) o_text = o_videoCard.desc; // Removed fallback
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
                ${o_text ? `<div class="orig-text">${o_text}</div>` : ''}
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
    const verifyType = Number(module_author.official_verify?.type)
    const verifyBadgeNoFrame = renderVerifyBadge(
        verifyType,
        'author-verify-badge--dynamic author-verify-badge--no-frame'
    )

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
    const hasFrame = !!pendantUrl
    const avatarWrapperClass = hasFrame
        ? 'avatar-wrapper avatar-wrapper--dynamic avatar-wrapper--with-frame'
        : 'avatar-wrapper avatar-wrapper--dynamic avatar-wrapper--no-frame'
    const verifyBadgeMain = renderVerifyBadge(
        verifyType,
        `author-verify-badge--dynamic ${hasFrame ? 'author-verify-badge--with-frame' : 'author-verify-badge--no-frame'}`
    )

    // 充电专属内容：渲染占位卡片
    const major = module_dynamic.major;
    if (major?.type === 'MAJOR_TYPE_BLOCKED') {
        const hint = major.blocked?.hint_message || '充电专属内容'
        const lines = hint.split('\n').map(escapeHtml)
        const blockedBgDay = major.blocked?.bg_img?.img_day || major.blocked?.bg_img?.img_dark || ''
        const blockedBgDark = major.blocked?.bg_img?.img_dark || blockedBgDay || ''
        const hasBlockedBg = !!(blockedBgDay || blockedBgDark)
        const blockedPanelClass = hasBlockedBg
            ? 'charging-blocked-panel charging-blocked-panel--with-bg'
            : 'charging-blocked-panel'
        const blockedBgHtml = hasBlockedBg
            ? `
                <img class="charging-blocked-bg charging-blocked-bg--day" src="${escapeHtml(blockedBgDay)}" alt="">
                <img class="charging-blocked-bg charging-blocked-bg--dark" src="${escapeHtml(blockedBgDark)}" alt="">
                <span class="charging-blocked-overlay"></span>
            `
            : ''
        // 充电专属占位卡片：有意省略 pendant/decoration，保持简洁
        return `
        <div class="content">
            <div class="header">
                <div class="header-left">
                    <div class="avatar-wrapper avatar-wrapper--dynamic avatar-wrapper--no-frame">
                        <img class="avatar no-frame" src="${authorFace}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                        ${verifyBadgeNoFrame}
                    </div>
                    <div class="user-info">
                        <span class="user-name">${escapeHtml(authorName)}</span>
                        <span class="pub-time">${escapeHtml(String(pubTime))}</span>
                    </div>
                </div>
            </div>
            <div class="charging-blocked-hint">
                <div class="${blockedPanelClass}">
                    ${blockedBgHtml}
                    <div class="charging-blocked-text">
                        ${lines.map(l => `<p>${l}</p>`).join('')}
                    </div>
                </div>
            </div>
            <div class="action-bar">
                <div class="action-item">${ICONS.share} ${formatNumber(module_stat.forward?.count)}</div>
                <div class="action-item">${ICONS.comment} ${formatNumber(module_stat.comment?.count)}</div>
                <div class="action-item">${ICONS.like} ${formatNumber(module_stat.like?.count)}</div>
            </div>
        </div>`
    }

    let text = "";
    let title = "";
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

    let images = collectDynamicImages(module_dynamic);
    const resolvedText = resolveDynamicText(module_dynamic, images.length > 0);
    text = parseRichText(resolvedText.richTextNodes, resolvedText.text);
    title = resolvedText.title;

    const dynamicId = item.id_str || data.data?.id_str || '';
    if (resolvedText.source !== 'desc' && resolvedText.text) {
        logger.debug(`[DynamicRenderer] Dynamic ${dynamicId}: text source fallback -> ${resolvedText.source}`);
    }

    const voteObj = getVoteFromModules(modules);
    const voteHtml = renderVoteCard(voteObj);

    let videoCard = null;

    if (module_dynamic.major?.archive) {
         videoCard = module_dynamic.major.archive;
         // if(!text) text = videoCard.desc; // Removed fallback
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
                    <div class="${avatarWrapperClass}">
                        <img class="avatar ${pendantUrl ? 'no-border' : 'no-frame'}" src="${authorFace}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                        ${pendantUrl ? `<img class="avatar-frame" src="${pendantUrl}" />` : ''}
                        ${verifyBadgeMain}
                    </div>
                    <div class="user-info">
                        <span class="user-name">${authorName} ${authorLevel ? `<span class="user-level lv${authorLevel}">Lv${authorLevel}</span>` : ''}</span>
                        <span class="pub-time">${escapeHtml(String(pubTime))}</span>
                    </div>
                </div>
                <div class="header-right">
                    ${cardUrl ? `
                        <div class="decoration-card-wrapper">
                            <img class="decoration-card" src="${cardUrl}" />
                            ${serial ? `<span class="serial-badge" style="--serial-color: ${fanColor};">No.${serial}</span>` : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
            ${title ? `<div class="title">${title}</div>` : ''}
            <div class="text-content">${text}</div>
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

module.exports = {
    renderDynamicContent,
    renderOrigContent,
    __internal: {
        normalizePlainText,
        stripImagePlaceholders,
        normalizeRichTextNodes,
        normalizeForNodeCompare,
        canBorrowSummaryNodes,
        buildNodesFromSummary,
        injectTopicNodeIfNeeded,
        collectDynamicImages,
        resolveDynamicText
    }
};
