const { escapeHtml, formatPubTime, formatNumber } = require('../core/formatters');
const { parseRichText } = require('./components/richtext');
const { resolvePlainTextContent } = require('./components/contentNodes');
const { renderVerifyBadge } = require('./components/verifyBadge');
const ICONS = require('./icons');

function normalizeArticleSummary(summary) {
    return resolvePlainTextContent(summary).text
}

function resolveArticleRenderPayload(info) {
    return info?.render_payload?.data?.item?.modules?.module_dynamic || {}
}

function resolveArticleTitleContent(info) {
    const dynamicModule = resolveArticleRenderPayload(info)
    const payloadTitle = dynamicModule?.major?.opus?.title || ''
    return resolvePlainTextContent(payloadTitle || info.title)
}

function resolveArticleSummaryContent(info) {
    const dynamicModule = resolveArticleRenderPayload(info)
    const summaryObj = dynamicModule?.major?.opus?.summary || {}
    const descObj = dynamicModule?.desc || {}
    const fallbackText = normalizeArticleSummary(
        summaryObj.text || descObj.text || info.summary || ''
    )
    const richTextNodes = Array.isArray(summaryObj.rich_text_nodes) && summaryObj.rich_text_nodes.length > 0
        ? summaryObj.rich_text_nodes
        : (Array.isArray(descObj.rich_text_nodes) && descObj.rich_text_nodes.length > 0
            ? descObj.rich_text_nodes
            : null)

    if (richTextNodes) {
        return {
            text: fallbackText,
            richTextNodes
        }
    }

    return resolvePlainTextContent(fallbackText)
}

function resolveArticleCover(info) {
    if (info?.banner_url) return info.banner_url
    if (Array.isArray(info?.image_urls) && info.image_urls[0]) return info.image_urls[0]

    const dynamicModule = resolveArticleRenderPayload(info)
    const pics = dynamicModule?.major?.opus?.pics || []
    if (Array.isArray(pics) && pics[0]?.url) return pics[0].url

    return ''
}

function resolveArticleStats(info) {
    const stats = info?.stats || {}
    const dynamicStat = info?.render_payload?.data?.item?.modules?.module_stat || {}
    return {
        share: stats.share ?? dynamicStat.forward?.count ?? 0,
        like: stats.like ?? dynamicStat.like?.count ?? 0,
        reply: stats.reply ?? dynamicStat.comment?.count ?? 0
    }
}

function resolveArticlePubTime(info) {
    const payloadItem = info?.render_payload?.data?.item || {}
    const moduleAuthor = payloadItem?.modules?.module_author || {}

    return formatPubTime(info?.publish_time)
        || formatPubTime(info?.pub_ts)
        || formatPubTime(payloadItem?.pub_ts)
        || formatPubTime(moduleAuthor?.pub_ts)
        || moduleAuthor?.pub_time
        || ''
}

function resolveArticleAuthorDecoration(info) {
    const payloadItem = info?.render_payload?.data?.item || {}
    const moduleAuthor = payloadItem?.modules?.module_author || {}
    const payloadAuthor = payloadItem?.author || info?.render_payload?.data?.author || {}
    const payloadDecorationCard = moduleAuthor?.decoration_card || {}

    return {
        pendantUrl: info?.author_pendant_url || payloadAuthor?.pendant_url || moduleAuthor?.pendant?.image || '',
        cardUrl: info?.author_card_url || payloadAuthor?.card_url || payloadDecorationCard?.card_url || info?.author_nameplate_url || '',
        fanNumber: info?.author_card_number || payloadDecorationCard?.fan?.num_desc || payloadDecorationCard?.card_number || '',
        fanColor: info?.author_fan_color || payloadAuthor?.fan_color || payloadDecorationCard?.fan?.color || '#555',
        level: Number(info?.author_level ?? payloadAuthor?.level ?? moduleAuthor?.level_info?.current_level ?? 0),
        verifyType: Number(info?.author_official_verify_type ?? moduleAuthor?.official_verify?.type ?? -1)
    }
}

/**
 * 渲染专栏内容
 * @param {Object} data - 专栏数据
 * @param {Object|null} emojiContext - 当前卡片表情渲染上下文
 * @returns {String} HTML 字符串
 */
function renderArticleContent(data, emojiContext = null) {
    const info = data.data;
    const pubDate = resolveArticlePubTime(info)
    const authorFace = info.author_face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';
    const authorDecoration = resolveArticleAuthorDecoration(info)
    const cover = resolveArticleCover(info)
    const stats = resolveArticleStats(info)
    const resolvedTitle = resolveArticleTitleContent(info)
    const resolvedSummary = resolveArticleSummaryContent(info)
    const contentHtml = parseRichText(resolvedSummary.richTextNodes, resolvedSummary.text, emojiContext)
    const hasFrame = !!authorDecoration.pendantUrl
    const avatarWrapperClass = hasFrame
        ? 'avatar-wrapper avatar-wrapper--dynamic avatar-wrapper--with-frame'
        : 'avatar-wrapper avatar-wrapper--dynamic avatar-wrapper--no-frame'
    const verifyBadgeHtml = renderVerifyBadge(
        authorDecoration.verifyType,
        `author-verify-badge--dynamic ${hasFrame ? 'author-verify-badge--with-frame' : 'author-verify-badge--no-frame'}`
    )

    return `
        <div class="content">
            <div class="header">
                <div class="header-left">
                    <div class="${avatarWrapperClass}">
                        <img class="avatar ${authorDecoration.pendantUrl ? 'no-border' : 'no-frame'}" src="${authorFace}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                        ${authorDecoration.pendantUrl ? `<img class="avatar-frame" src="${escapeHtml(authorDecoration.pendantUrl)}" />` : ''}
                        ${verifyBadgeHtml}
                    </div>
                    <div class="user-info">
                        <span class="user-name">${escapeHtml(info.author_name || 'Unknown')}
                            ${authorDecoration.level ? `<span class="user-level lv${authorDecoration.level}">Lv${authorDecoration.level}</span>` : ''}
                        </span>
                        <span class="pub-time">${pubDate}</span>
                    </div>
                </div>
                <div class="header-right">
                    ${authorDecoration.cardUrl ? `
                        <div class="decoration-card-wrapper">
                            <img class="decoration-card" src="${escapeHtml(authorDecoration.cardUrl)}" />
                            ${authorDecoration.fanNumber ? `<span class="serial-badge" style="--serial-color: ${escapeHtml(authorDecoration.fanColor)};">No.${escapeHtml(String(authorDecoration.fanNumber))}</span>` : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
            ${cover ? `
                <div class="cover-container article-cover-container">
                    <img class="cover article" src="${escapeHtml(cover)}" onerror="this.style.display='none'">
                </div>
            ` : ''}
            <div class="title">${parseRichText(resolvedTitle.richTextNodes, resolvedTitle.text, emojiContext)}</div>
            <div class="text-content article-excerpt">${contentHtml}</div>
            <div class="stats article-stats">
                <span class="stat-item">${ICONS.share} ${formatNumber(stats.share)}</span>
                <span class="stat-item">${ICONS.like} ${formatNumber(stats.like)}</span>
                <span class="stat-item">${ICONS.comment} ${formatNumber(stats.reply)}</span>
            </div>
        </div>
    `;
}

module.exports = {
    renderArticleContent,
    __internal: {
        normalizeArticleSummary,
        resolveArticlePubTime,
        resolveArticleAuthorDecoration
    }
};
