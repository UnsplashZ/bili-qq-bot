const { escapeHtml } = require('../../core/formatters');
const { parseRichText } = require('./richtext');

function normalizePlainText(value) {
    if (!value) return ''
    return String(value).trim()
}

function toSafeNumber(value) {
    const num = Number(value)
    return Number.isFinite(num) ? num : 0
}

function normalizeStats(stats) {
    if (!Array.isArray(stats)) return []
    return stats
        .map((item) => {
            if (!item || typeof item !== 'object') return null
            const label = normalizePlainText(item.label)
            const value = item.value
            if (!label && (value === null || value === undefined || value === '')) return null
            return {
                label,
                value: value === null || value === undefined ? '' : String(value)
            }
        })
        .filter(Boolean)
}

function normalizeOpusLinkCard(card) {
    if (!card || typeof card !== 'object') return null

    const title = normalizePlainText(card.title)
    const subtitle = normalizePlainText(card.subtitle)
    const desc = normalizePlainText(card.desc)
    const coverUrl = normalizePlainText(card.cover_url || card.coverUrl)
    const badgeText = normalizePlainText(card.badge_text || card.badgeText)
    const durationText = normalizePlainText(card.duration_text || card.durationText)
    const jumpUrl = normalizePlainText(card.jump_url || card.jumpUrl)
    const stats = normalizeStats(card.stats)

    if (!title && !subtitle && !desc && !coverUrl && stats.length === 0) return null

    return {
        cardType: normalizePlainText(card.card_type || card.cardType),
        title,
        subtitle,
        desc,
        coverUrl,
        coverWidth: toSafeNumber(card.cover_width || card.coverWidth),
        coverHeight: toSafeNumber(card.cover_height || card.coverHeight),
        badgeText,
        durationText,
        jumpUrl,
        stats
    }
}

function resolveOpusLinkCards(dynamicModule) {
    if (!dynamicModule || typeof dynamicModule !== 'object') return []
    const cards = dynamicModule.additional?.opus_link_cards
    if (!Array.isArray(cards) || cards.length === 0) return []
    return cards.map(normalizeOpusLinkCard).filter(Boolean)
}

function renderStatChips(stats) {
    if (!Array.isArray(stats) || stats.length === 0) return ''

    return `
        <div class="opus-link-card-stats">
            ${stats.slice(0, 3).map((item) => {
                const value = escapeHtml(String(item.value || ''))
                if (!value) return ''
                const label = item.label ? `${escapeHtml(String(item.label))} ` : ''
                return `<span class="opus-link-card-stat">${label}${value}</span>`
            }).join('')}
        </div>
    `
}

function renderMetaChips({ badgeText, subtitle }, emojiContext) {
    const texts = []

    if (badgeText) {
        texts.push(`<span class="opus-link-card-stat">${escapeHtml(String(badgeText))}</span>`)
    }
    if (subtitle) {
        texts.push(`<span class="opus-link-card-stat">${parseRichText(null, subtitle, emojiContext)}</span>`)
    }

    if (texts.length === 0) return ''
    return `<div class="opus-link-card-meta">${texts.join('')}</div>`
}

function mergeStatsWithDuration(stats, durationText, cardType) {
    const normalizedStats = Array.isArray(stats) ? stats.slice(0, 3) : []
    if (!durationText) return normalizedStats
    if (cardType !== 'LINK_CARD_TYPE_UGC') return normalizedStats

    return [
        { label: '时长', value: durationText },
        ...normalizedStats
    ].slice(0, 3)
}

function renderOpusLinkCard(card, options = {}) {
    const normalized = normalizeOpusLinkCard(card)
    if (!normalized) return ''

    const {
        cardType,
        title,
        subtitle,
        desc,
        coverUrl,
        badgeText,
        durationText,
        jumpUrl,
        stats
    } = normalized
    const emojiContext = options.emojiContext || null
    const classNames = ['opus-link-card']
    if (!coverUrl) classNames.push('opus-link-card--no-cover')
    const safeCoverUrl = coverUrl ? escapeHtml(String(coverUrl)) : ''
    const safeJumpUrl = jumpUrl ? escapeHtml(String(jumpUrl)) : ''
    const mergedStats = mergeStatsWithDuration(
        stats,
        durationText,
        cardType
    )
    const displayBadgeText = cardType === 'LINK_CARD_TYPE_UGC' ? '' : badgeText

    return `
        <div class="${classNames.join(' ')}"${safeJumpUrl ? ` data-jump-url="${safeJumpUrl}"` : ''}>
            ${safeCoverUrl ? `
                <div class="opus-link-card-cover">
                    <img class="opus-link-card-cover-img" src="${safeCoverUrl}">
                </div>
            ` : ''}
            <div class="opus-link-card-body">
                ${title ? `<div class="opus-link-card-title">${parseRichText(null, title, emojiContext)}</div>` : ''}
                ${renderMetaChips({ badgeText: displayBadgeText, subtitle }, emojiContext)}
                ${renderStatChips(mergedStats)}
                ${desc ? `<div class="opus-link-card-desc">${parseRichText(null, desc, emojiContext)}</div>` : ''}
            </div>
        </div>
    `
}

function renderOpusLinkCards(cards, options = {}) {
    if (!Array.isArray(cards) || cards.length === 0) return ''
    return cards
        .map((card) => renderOpusLinkCard(card, options))
        .filter(Boolean)
        .join('')
}

module.exports = {
    normalizeOpusLinkCard,
    resolveOpusLinkCards,
    renderOpusLinkCard,
    renderOpusLinkCards
}
