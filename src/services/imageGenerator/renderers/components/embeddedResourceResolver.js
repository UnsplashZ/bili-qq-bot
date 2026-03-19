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

function firstNonEmpty(...values) {
    for (const value of values) {
        if (value === null || value === undefined) continue
        const text = String(value).trim()
        if (text) return text
    }
    return ''
}

function normalizeJumpUrl(url) {
    if (!url) return ''
    const raw = String(url)
    if (raw.startsWith('//')) return `https:${raw}`
    return raw
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

function resolveDynamicEmbeddedResourceCard(dynamicModule) {
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
        cover: firstNonEmpty(commonCard.cover, commonCard.cover_url),
        badgeText: firstNonEmpty(commonCard.head_text, commonCard.badge?.text, 'Bilibili'),
        jumpUrl: firstNonEmpty(commonCard.jump_url, commonCard.button?.jump_url),
        stats: commonCard.stats || commonCard.stat,
        variant: 'compact',
        placement: 'after_media'
    })
}

module.exports = {
    normalizeJumpUrl,
    normalizeEmbeddedStats,
    resolveEmbeddedKindMeta,
    resolveEmbeddedKindByKey,
    buildEmbeddedResourceCard,
    resolveDynamicEmbeddedResourceCard,
    resolveDynamicCommonCard
}
