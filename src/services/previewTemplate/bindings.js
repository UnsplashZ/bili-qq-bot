'use strict'

const { formatNumber, formatDuration, formatPubTime } = require('../imageGenerator/core/formatters')
const { getAllowedBindings } = require('./schema')
const { PreviewTemplateValidationError } = require('./normalizer')

function first(...values) {
    return values.find(value => value !== undefined && value !== null && value !== '') || ''
}

function firstImage(value) {
    if (Array.isArray(value)) {
        const item = value[0]
        return first(item?.src, item?.url, item?.cover, item?.cover_url)
    }
    return first(value)
}

function safeImageUrl(value, options = {}) {
    if (!value) return ''
    const text = String(value).trim()
    if (options.allowDataImage === true && /^data:image\/svg\+xml;charset=UTF-8,/i.test(text)) return text
    const normalized = text.startsWith('//') ? `https:${text}` : text
    if (!/^https?:\/\/[^ "'<>]+$/i.test(normalized)) return ''
    try {
        const url = new URL(normalized)
        if (url.protocol !== 'https:') return ''
        const host = url.hostname.toLowerCase()
        if (
            host === 'bilibili.com' ||
            host.endsWith('.bilibili.com') ||
            host === 'hdslb.com' ||
            host.endsWith('.hdslb.com') ||
            host === 'biliimg.com' ||
            host.endsWith('.biliimg.com')
        ) {
            return url.toString()
        }
    } catch {
        return ''
    }
    return ''
}

function safeInternalImageUrl(value) {
    return safeImageUrl(value, { allowDataImage: true })
}

function createPlaceholderImage(label = 'IMAGE') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" rx="24" fill="#E7EDF7"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-size="42" fill="#64748B">${label}</text></svg>`
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function plainRich(value) {
    if (typeof value === 'string') {
        // Strip HTML tags and their attributes entirely, then collapse whitespace.
        // Using a two-pass approach: first remove all tags (including attributes),
        // then clean up residual whitespace.
        return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    }
    if (value?.text) return value.text
    if (Array.isArray(value?.rich_text_nodes)) return value.rich_text_nodes.map(node => node.text || node.orig_text || '').join('')
    return ''
}

function normalizeStats(raw = {}) {
    return {
        views: first(raw.view, raw.views, raw.play, raw.count),
        likes: first(raw.like, raw.likes, raw.follow),
        comments: first(raw.reply, raw.comments, raw.danmaku, raw.danmakus),
        shares: first(raw.share, raw.shares, raw.favorite)
    }
}

function buildViewModel(type, data = {}, options = {}) {
    const info = data.data || data || {}
    const owner = info.owner || info.author || info.modules?.module_author || {}
    const roomInfo = info.room_info || {}
    const anchorInfo = info.anchor_info || {}
    const seasonStat = info.stat || {}
    const dynamicItem = info.item || info
    const modules = dynamicItem.modules || info.modules || {}
    const moduleAuthor = modules.module_author || owner
    const dynamicDesc = modules.module_dynamic?.desc || dynamicItem.desc || {}
    const major = modules.module_dynamic?.major || dynamicItem.major || {}
    const liveStatus = roomInfo.live_status === 1 ? 'LIVE' : 'OFFLINE'
    const userCard = info.card || info
    const latestDynamic = info.latest_dynamic || info.dynamic || {}
    const fallbackTypeLabel = {
        video: '视频',
        dynamic: '动态',
        article: '专栏',
        live: '直播',
        bangumi: '番剧',
        user: '用户'
    }[type] || type

    return {
        card: {
            type,
            typeLabel: fallbackTypeLabel,
            url: options.url || data.url || '',
            id: first(info.bvid, info.aid, info.id, info.room_id, info.uid, info.season_id),
            placeholderImage: createPlaceholderImage(fallbackTypeLabel)
        },
        author: {
            name: first(owner.name, owner.uname, moduleAuthor.name, moduleAuthor.uname, anchorInfo.base_info?.uname, userCard.name),
            avatar: safeInternalImageUrl(first(owner.face, moduleAuthor.face, anchorInfo.base_info?.face, userCard.face)),
            uid: first(owner.mid, owner.uid, moduleAuthor.mid, userCard.mid, userCard.uid),
            verifyType: first(owner.official_verify?.type, moduleAuthor.official_verify?.type)
        },
        time: {
            pubText: info.pubdate ? formatPubTime(info.pubdate) : first(moduleAuthor.pub_time, info.pub_time, info.ctime_text)
        },
        stats: normalizeStats(info.stat || info.view || info.watched_show || seasonStat),
        video: {
            title: plainRich(info.title),
            cover: safeInternalImageUrl(first(info.pic, info.cover)),
            desc: plainRich(info.desc),
            duration: info.duration ? formatDuration(info.duration) : ''
        },
        dynamic: {
            title: plainRich(modules.module_dynamic?.major?.archive?.title || dynamicItem.title),
            text: plainRich(dynamicDesc),
            media: safeInternalImageUrl(firstImage(major.draw?.items || major.archive?.cover || major.live_rcmd?.cover || info.cover)),
            embeddedTitle: first(major.archive?.title, major.common?.title, major.live_rcmd?.title, dynamicItem.title),
            origText: plainRich(dynamicItem.orig?.modules?.module_dynamic?.desc || dynamicItem.orig?.desc)
        },
        article: {
            title: plainRich(info.title),
            cover: safeInternalImageUrl(first(info.image_urls?.[0], info.banner_url, info.cover)),
            summary: plainRich(info.summary || info.desc || info.content),
            bodyPreview: plainRich(info.content || info.summary)
        },
        live: {
            title: plainRich(roomInfo.title),
            cover: safeInternalImageUrl(first(roomInfo.cover, info.cover)),
            roomId: roomInfo.room_id ? `直播间: ${roomInfo.room_id}` : '',
            statusText: liveStatus
        },
        bangumi: {
            title: plainRich(info.title),
            cover: safeInternalImageUrl(first(info.cover)),
            progress: plainRich(info.desc || info.evaluate),
            statusLine: first(info.new_ep?.desc, info.type_desc, info.publish?.release_date_show)
        },
        user: {
            name: first(userCard.name, info.name, owner.name),
            avatar: safeInternalImageUrl(first(userCard.face, info.face, owner.face)),
            signature: plainRich(userCard.sign || info.sign || info.signature),
            uid: options.showId === false ? '' : (userCard.mid || userCard.uid || info.uid || info.mid ? `UID: ${userCard.mid || userCard.uid || info.uid || info.mid}` : ''),
            recentDynamicText: plainRich(latestDynamic.text || latestDynamic.desc)
        }
    }
}

function getPath(source, viewModel) {
    if (!source || source === 'static') return undefined
    const allowed = new Set()
    for (const type of ['video', 'dynamic', 'article', 'live', 'bangumi', 'user']) {
        for (const item of getAllowedBindings(type)) allowed.add(item)
    }
    if (!allowed.has(source) || /data\.|render_payload|modules\.|raw/.test(source)) {
        throw new PreviewTemplateValidationError(`binding source is not allowed: ${source}`)
    }
    return source.split('.').reduce((current, key) => {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined
        return current?.[key]
    }, viewModel)
}

function resolveBinding(binding = {}, viewModel = {}) {
    if (binding.source === 'static') {
        const value = binding.value || binding.fallback || ''
        return binding.format === 'imageUrl' ? safeImageUrl(value) : value
    }
    const value = getPath(binding.source, viewModel)
    const fallback = binding.fallback || ''
    if (value === undefined || value === null || value === '') {
        return binding.format === 'imageUrl' ? safeImageUrl(fallback) : fallback
    }
    if (binding.format === 'numberCompact') return formatNumber(value)
    if (binding.format === 'imageUrl') return safeInternalImageUrl(value)
    return String(value)
}

module.exports = {
    buildViewModel,
    createSafeViewModel: buildViewModel,
    resolveBinding,
    createPlaceholderImage,
    safeImageUrl,
    safeInternalImageUrl
}
