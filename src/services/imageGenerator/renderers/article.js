const { escapeHtml, formatPubTime, formatNumber } = require('../core/formatters');
const { parseRichText } = require('./components/richtext');
const { replaceEmojiTokensInHtml } = require('./components/articleHtmlEmoji');
const { resolvePlainTextContent } = require('./components/contentNodes');
const { renderDynamicContent } = require('./dynamic');
const ICONS = require('./icons');

const EMPTY_PARAGRAPH_START_RE = /^\s*<p(?:\s[^>]*)?>\s*(?:<br\s*\/?>|&nbsp;|\u00a0|\s)*\s*<\/p>/i
const EMPTY_PARAGRAPH_END_RE = /<p(?:\s[^>]*)?>\s*(?:<br\s*\/?>|&nbsp;|\u00a0|\s)*\s*<\/p>\s*$/i

function trimArticleBlankParagraphs(html) {
    if (!html || typeof html !== 'string') return ''

    let normalized = html.replace(/\u200b/g, '').trim()
    while (EMPTY_PARAGRAPH_START_RE.test(normalized)) {
        normalized = normalized.replace(EMPTY_PARAGRAPH_START_RE, '').trimStart()
    }
    while (EMPTY_PARAGRAPH_END_RE.test(normalized)) {
        normalized = normalized.replace(EMPTY_PARAGRAPH_END_RE, '').trimEnd()
    }
    return normalized
}

function normalizeArticleSummary(summary) {
    return resolvePlainTextContent(summary).text
}

/**
 * 渲染专栏内容
 * @param {Object} data - 专栏数据
 * @param {Object|null} emojiContext - 当前卡片表情渲染上下文
 * @returns {String} HTML 字符串
 */
function renderArticleContent(data, emojiContext = null) {
    const info = data.data;
    if (info?.render_type === 'dynamic' && info.render_payload) {
        return renderDynamicContent(info.render_payload, emojiContext)
    }
    const pubDate = formatPubTime(info.publish_time);
    const authorFace = info.author_face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';
    const hasHtmlContent = !!info.html_content;
    const contentClass = hasHtmlContent ? 'article-body' : 'text-content';
    const resolvedTitle = resolvePlainTextContent(info.title)
    const resolvedSummary = resolvePlainTextContent(normalizeArticleSummary(info.summary || ''))
    const contentHtml = hasHtmlContent
        ? replaceEmojiTokensInHtml(trimArticleBlankParagraphs(info.html_content), emojiContext)
        : parseRichText(resolvedSummary.richTextNodes, resolvedSummary.text, emojiContext);

    return `
        <div class="content">
            <div class="header">
                <div class="header-left">
                    <div class="avatar-wrapper">
                        <img class="avatar no-frame" src="${authorFace}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                    </div>
                    <div class="user-info">
                        <span class="user-name">${escapeHtml(info.author_name || 'Unknown')}</span>
                        <span class="pub-time">${pubDate}</span>
                    </div>
                </div>
            </div>
            <div class="title">${parseRichText(resolvedTitle.richTextNodes, resolvedTitle.text, emojiContext)}</div>
            <div class="${contentClass}">${contentHtml}</div>
            <div class="stats article-stats">
                <span class="stat-item">${ICONS.share} ${formatNumber(info.stats?.share)}</span>
                <span class="stat-item">${ICONS.like} ${formatNumber(info.stats?.like)}</span>
                <span class="stat-item">${ICONS.comment} ${formatNumber(info.stats?.reply)}</span>
            </div>
        </div>
    `;
}

module.exports = {
    renderArticleContent,
    __internal: {
        trimArticleBlankParagraphs,
        normalizeArticleSummary
    }
};
