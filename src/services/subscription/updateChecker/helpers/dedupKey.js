function normalizeType(type, payload) {
    const input = String(type || payload?.type || '').trim().toLowerCase()
    if (!input) return ''
    if (input === 'movie' || input === 'tv' || input === 'guocha' || input === 'doc' || input === 'variety') {
        return 'bangumi'
    }
    return input
}

function toStringId(value) {
    if (value === null || value === undefined) return ''
    const text = String(value).trim()
    return text || ''
}

function resolveVideoId(data) {
    return toStringId(data?.bvid || data?.archive?.bvid || data?.aid)
}

function resolveArticleId(data) {
    const raw = toStringId(data?.id || data?.cvid)
    if (!raw) return ''
    return raw.startsWith('cv') ? raw : `cv${raw}`
}

function resolveDynamicId(data) {
    return toStringId(
        data?.id_str ||
        data?.id ||
        data?.item?.id_str ||
        data?.item?.id ||
        data?.desc?.dynamic_id_str ||
        data?.desc?.dynamic_id
    )
}

function resolveLiveId(payload, data) {
    return toStringId(
        payload?.id ||
        data?.id ||
        data?.room_id ||
        data?.roomid ||
        data?.room_info?.room_id ||
        data?.room_info?.roomid
    )
}

function resolveBangumiId(payload, data) {
    return toStringId(
        payload?.ep_id ||
        data?.ep_id ||
        data?.new_ep?.id ||
        data?.new_ep?.ep_id
    )
}

function resolveDedupKey(type, payload) {
    const data = payload?.data || payload || {}
    const normalizedType = normalizeType(type, payload)
    if (!normalizedType) return null

    if (normalizedType === 'video') {
        const id = resolveVideoId(data)
        return id ? `video:${id}` : null
    }

    if (normalizedType === 'article') {
        const id = resolveArticleId(data)
        return id ? `article:${id}` : null
    }

    if (normalizedType === 'dynamic') {
        const id = resolveDynamicId(data)
        return id ? `dynamic:${id}` : null
    }

    if (normalizedType === 'live') {
        const id = resolveLiveId(payload, data)
        return id ? `live:${id}` : null
    }

    if (normalizedType === 'bangumi') {
        const id = resolveBangumiId(payload, data)
        return id ? `bangumi:ep${id}` : null
    }

    return null
}

module.exports = {
    resolveDedupKey
}
