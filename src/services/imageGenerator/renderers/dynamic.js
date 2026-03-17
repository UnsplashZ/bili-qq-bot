const { formatPubTime, formatNumber, escapeHtml } = require('../core/formatters');
const { parseRichText } = require('./components/richtext');
const {
    collectDynamicImages: sharedCollectDynamicImages,
    resolveDynamicContent
} = require('./components/contentNodes');
const { renderVoteCard, getVoteFromModules } = require('./components/vote');
const { renderEmbeddedResourceCard, renderMediaHtml } = require('./components/media');
const { renderOpusLinkCards, resolveOpusLinkCards } = require('./components/opusLinkCard');
const { renderVerifyBadge } = require('./components/verifyBadge');
const ICONS = require('./icons');
const logger = require('../../../utils/logger');

const EMBEDDED_KIND_META = {
    favorite_list: { label: '收藏夹', color: '#FF8A00' },
    audio: { label: '音频', color: '#8E6BFF' },
    audio_list: { label: '歌单', color: '#6E56CF' },
    topic: { label: '话题', color: '#00B5E5' },
    channel_series: { label: '合集', color: '#26A69A' },
    article_list: { label: '文集', color: '#FAA023' },
    note: { label: '笔记', color: '#4CAF50' },
    cheese_video: { label: '课程', color: '#FF7043' },
    interactive_video: { label: '互动视频', color: '#FB7299' },
    bangumi: { label: '番剧', color: '#00A1D6' },
    generic: { label: 'Bilibili', color: '#5B86E5' }
}

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

function hasRichLinkNodes(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) return false
    const richTypes = new Set([
        'RICH_TEXT_NODE_TYPE_WEB',
        'RICH_TEXT_NODE_TYPE_URL',
        'RICH_TEXT_NODE_TYPE_BV',
        'RICH_TEXT_NODE_TYPE_VOTE',
        'RICH_TEXT_NODE_TYPE_LOTTERY'
    ])
    return nodes.some(node => richTypes.has(node?.type))
}

function looksLikeAddressLabelButMissingValue(text) {
    const normalized = normalizePlainText(text)
    if (!normalized) return false
    const hasAddressLabel = /直播间地址[:：]|下载(?:游戏|地址)?[:：]/.test(normalized)
    const hasUrl = /https?:\/\/|www\./i.test(normalized)
    return hasAddressLabel && !hasUrl
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
    return [
        {
            type: 'RICH_TEXT_NODE_TYPE_TOPIC',
            text: topic.name,
            orig_text: topic.name,
            jump_url: jumpUrl
        },
        {
            type: 'RICH_TEXT_NODE_TYPE_TEXT',
            text: '\n',
            orig_text: '\n'
        },
        ...nodes
    ]
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

function normalizeJumpUrl(url) {
    if (!url) return ''
    const raw = String(url)
    if (raw.startsWith('//')) return `https:${raw}`
    return raw
}

function firstNonEmpty(...values) {
    for (const value of values) {
        if (value === null || value === undefined) continue
        const text = String(value).trim()
        if (text) return text
    }
    return ''
}

function normalizeEmbeddedStats(statsLike) {
    if (!statsLike) return []
    if (Array.isArray(statsLike)) {
        return statsLike
            .map((item) => {
                if (!item || typeof item !== 'object') return null
                if (item.value === null || item.value === undefined || item.value === '') return null
                return {
                    label: item.label || '',
                    value: item.value
                }
            })
            .filter(Boolean)
    }
    if (typeof statsLike !== 'object') return []

    const keyLabelMap = {
        count: '内容',
        total: '内容',
        media_count: '内容',
        play: '播放',
        view: '播放',
        vt: '播放',
        collect: '收藏',
        favorite: '收藏',
        follower: '关注',
        fans: '粉丝'
    }

    return Object.entries(statsLike)
        .slice(0, 3)
        .map(([key, value]) => {
            if (value === null || value === undefined || value === '') return null
            return {
                label: keyLabelMap[key] || key,
                value
            }
        })
        .filter(Boolean)
}

function resolveEmbeddedKindMeta(kind) {
    return EMBEDDED_KIND_META[kind] || EMBEDDED_KIND_META.generic
}

function resolveEmbeddedKindByKey(key, candidate = {}) {
    const mapped = {
        medialist: 'favorite_list',
        audio: 'audio',
        music: 'audio',
        playlist: 'audio_list',
        ugc_season: 'channel_series',
        article: 'article_list',
        note: 'note',
        courses: 'cheese_video',
        cheese: 'cheese_video',
        topic: 'topic',
        pgc: 'bangumi'
    }
    if (mapped[key]) return mapped[key]
    if (candidate.badge?.text === '收藏') return 'favorite_list'
    return 'generic'
}

function buildEmbeddedResourceCard(kind, candidate, overrides = {}) {
    if (!candidate || typeof candidate !== 'object') return null

    const meta = resolveEmbeddedKindMeta(kind)
    const title = firstNonEmpty(
        overrides.title,
        candidate.title,
        candidate.name,
        candidate.head_text
    )
    const subtitle = firstNonEmpty(
        overrides.subtitle,
        candidate.sub_title,
        candidate.subtitle,
        candidate.desc1
    )
    const desc = firstNonEmpty(
        overrides.desc,
        candidate.desc,
        candidate.description,
        candidate.desc2,
        candidate.summary
    )
    const cover = normalizeJumpUrl(firstNonEmpty(
        overrides.cover,
        candidate.cover,
        candidate.cover_url,
        candidate.image,
        candidate.pic
    ))
    const badgeText = firstNonEmpty(
        overrides.badgeText,
        candidate.badge?.text,
        meta.label
    )
    const badgeColor = firstNonEmpty(
        overrides.badgeColor,
        candidate.badge?.bg_color,
        meta.color
    )
    const jumpUrl = normalizeJumpUrl(firstNonEmpty(
        overrides.jumpUrl,
        candidate.jump_url,
        candidate.url,
        candidate.uri
    ))
    const stats = normalizeEmbeddedStats(
        overrides.stats || candidate.stats || candidate.stat
    )

    if (!title && !subtitle && !desc && !cover) return null

    return {
        kind,
        title,
        subtitle,
        desc,
        cover,
        badgeText,
        badgeColor,
        jumpUrl,
        stats,
        variant: overrides.variant || '',
        placement: overrides.placement || 'before_media'
    }
}

function resolveOrigEmbeddedResourceCard(dynamicModule) {
    if (!dynamicModule || typeof dynamicModule !== 'object') return null

    const major = dynamicModule.major || {}

    if (major.medialist) {
        return buildEmbeddedResourceCard('favorite_list', major.medialist, {
            subtitle: firstNonEmpty(major.medialist.sub_title, major.medialist.desc1)
        })
    }

    const majorCandidates = Object.entries(major).filter(([key, value]) => {
        if (key === 'type') return false
        if (key === 'archive' || key === 'draw' || key === 'opus' || key === 'live_rcmd' || key === 'common') return false
        return value && typeof value === 'object'
    })

    for (const [key, value] of majorCandidates) {
        const card = buildEmbeddedResourceCard(resolveEmbeddedKindByKey(key, value), value)
        if (card) return card
    }

    return null
}

function resolveDynamicCommonCard(dynamicModule) {
    if (!dynamicModule || typeof dynamicModule !== 'object') return null

    const major = dynamicModule.major || {}
    const additional = dynamicModule.additional || {}
    const commonCard = additional.common || major.common

    if (!commonCard || typeof commonCard !== 'object') return null

    return buildEmbeddedResourceCard('generic', commonCard, {
        title: firstNonEmpty(commonCard.title, commonCard.head_text),
        subtitle: firstNonEmpty(commonCard.desc1, commonCard.sub_title),
        desc: firstNonEmpty(commonCard.desc2, commonCard.desc),
        variant: 'compact',
        placement: 'after_media',
        badgeText: firstNonEmpty(commonCard.head_text, commonCard.badge?.text, 'Bilibili')
    })
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
    const summary = dynamicModule.major?.opus?.summary || {}
    const summaryText = summary.text || ''
    const summaryNodes = summary.rich_text_nodes

    if (dynamicModule.desc) {
        text = dynamicModule.desc.text || ''
        richTextNodes = dynamicModule.desc.rich_text_nodes
        source = 'desc'
    }

    const shouldPreferSummary =
        source === 'desc' &&
        normalizePlainText(summaryText) &&
        hasRichLinkNodes(summaryNodes) &&
        (
            looksLikeAddressLabelButMissingValue(text) ||
            ((!Array.isArray(richTextNodes) || richTextNodes.length === 0) && normalizePlainText(text))
        )

    if (shouldPreferSummary) {
        text = summaryText
        richTextNodes = summaryNodes
        source = 'opus_summary_preferred'
    }

    // desc 有正文但缺少 rich nodes 时，借用 summary 的富文本节点（用于恢复 emoji 等）
    if (
        source === 'desc' &&
        normalizePlainText(text) &&
        (!Array.isArray(richTextNodes) || richTextNodes.length === 0) &&
        dynamicModule.major?.opus?.summary
    ) {
        if (
            Array.isArray(summaryNodes) &&
            summaryNodes.length > 0 &&
            summaryNodes.some(node => node?.type && node.type !== 'RICH_TEXT_NODE_TYPE_TEXT') &&
            canBorrowSummaryNodes(text, summaryText)
        ) {
            const borrowedNodes = buildNodesFromSummary(text, summaryNodes)
            if (Array.isArray(borrowedNodes) && borrowedNodes.length > 0) {
                richTextNodes = borrowedNodes
                source = 'desc_with_summary_nodes'
            }
        }
    }

    if (!normalizePlainText(text) && dynamicModule.major?.opus?.summary) {
        text = summaryText
        richTextNodes = summaryNodes
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
 * @param {Object|null} emojiContext - 当前卡片表情渲染上下文
 * @returns {String} HTML 字符串
 */
function renderOrigContent(origItemRaw, emojiContext = null) {
    const oitem = origItemRaw.item ? origItemRaw.item : origItemRaw;
    const omodules = oitem.modules || {};
    const o_author = omodules.module_author || {};
    const o_dynamic = omodules.module_dynamic || {};

    const o_images = sharedCollectDynamicImages(o_dynamic);
    const resolvedOrig = resolveDynamicContent(o_dynamic, o_images.length > 0);
    const o_text = parseRichText(resolvedOrig.richTextNodes, resolvedOrig.text, emojiContext);
    const o_title = resolvedOrig.title;

    let o_videoCard = null;
    if (o_dynamic.major?.archive) {
        o_videoCard = o_dynamic.major.archive;
        // if (!o_text) o_text = o_videoCard.desc; // Removed fallback
    }

    const o_mediaHtml = renderMediaHtml(o_images, o_videoCard, true);
    const o_embeddedResource = resolveOrigEmbeddedResourceCard(o_dynamic)
    const o_embeddedResourceHtml = renderEmbeddedResourceCard(o_embeddedResource, {
        isOrig: true,
        emojiContext
    })
    const o_voteObj = getVoteFromModules(omodules);
    const o_voteHtml = renderVoteCard(o_voteObj);
    const o_name = o_author.name || 'Unknown';
    const o_face = o_author.face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';
    const o_pubTime = formatPubTime(oitem.pub_ts) || formatPubTime(o_author.pub_ts) || o_author.pub_time || '';
    const o_verifyType = Number(o_author.official_verify?.type)
    const o_verifyBadge = renderVerifyBadge(o_verifyType, 'author-verify-badge--orig')

    if (!o_title && !o_text && !o_voteHtml && !o_mediaHtml && !o_embeddedResourceHtml) {
        return ''
    }

    return `
        <div class="orig-card">
            <div class="orig-header">
                <div class="avatar-wrapper avatar-wrapper--orig">
                    <img class="orig-author-avatar" src="${escapeHtml(o_face)}">
                    ${o_verifyBadge}
                </div>
                <div class="orig-author-meta">
                    <span class="orig-author-name">${escapeHtml(o_name)}</span>
                    ${o_pubTime ? `<span class="orig-pub-time">${escapeHtml(String(o_pubTime))}</span>` : ''}
                </div>
            </div>
            <div class="orig-content">
                ${o_title ? `<div class="orig-title">${o_title}</div>` : ''}
                ${o_text ? `<div class="orig-text">${o_text}</div>` : ''}
                ${o_voteHtml}
                ${o_embeddedResourceHtml}
                ${o_mediaHtml}
            </div>
        </div>
    `;
}

/**
 * 渲染动态内容
 * @param {Object} data - 动态数据
 * @param {Object|null} emojiContext - 当前卡片表情渲染上下文
 * @returns {String} HTML 字符串
 */
function renderDynamicContent(data, emojiContext = null) {
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
            logger.logEvent('error', 'SERVICE', 'svc:dynamic-renderer', 'live-rcmd-parse-failed', {
                error: logger.getErrorMessage(e)
            });
        }
    }

    let images = sharedCollectDynamicImages(module_dynamic);
    const resolvedText = resolveDynamicContent(module_dynamic, images.length > 0);
    text = parseRichText(resolvedText.richTextNodes, resolvedText.text, emojiContext);
    title = resolvedText.title;

    const dynamicId = item.id_str || data.data?.id_str || '';
    if ((resolvedText.source !== 'desc' || (resolvedText.mergeModes || []).length > 0) && resolvedText.text) {
        logger.logEvent('debug', 'SERVICE', logger.createScope('dynamic', dynamicId || 'unknown'), 'text-source-fallback', {
            source: resolvedText.source,
            mergeModes: resolvedText.mergeModes,
            borrowedNodeTypes: resolvedText.borrowedNodeTypes
        });
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
    const opusLinkCards = resolveOpusLinkCards(module_dynamic)
    const opusLinkCardsHtml = renderOpusLinkCards(opusLinkCards, {
        emojiContext
    })
    const commonHtml = renderEmbeddedResourceCard(resolveDynamicCommonCard(module_dynamic), {
        emojiContext
    })

    let origHtml = '';
    if (item.orig) {
        origHtml = renderOrigContent(item.orig, emojiContext);
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
            ${origHtml}
            ${mediaHtml}
            ${opusLinkCardsHtml}
            ${voteHtml}
            ${commonHtml}
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
        collectDynamicImages: sharedCollectDynamicImages,
        resolveDynamicText: resolveDynamicContent,
        resolveDynamicCommonCard,
        resolveOpusLinkCards
    }
};
