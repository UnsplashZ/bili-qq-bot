'use strict'

function normalizeLiveStatus(value) {
    if (value === 0 || value === '0') return 0
    if (value === 1 || value === '1') return 1
    return null
}

function normalizeRoomId(...candidates) {
    for (const candidate of candidates) {
        const value = String(candidate || '').trim()
        if (/^\d+$/.test(value)) {
            return value
        }
    }
    return ''
}

function buildRoomUrl(roomId, ...candidates) {
    for (const candidate of candidates) {
        const value = String(candidate || '').trim()
        if (value) return value
    }
    return roomId ? `https://live.bilibili.com/${roomId}` : ''
}

function resolveLiveState({ liveRoom = {}, cachedRoomId = '', roomInfo = null } = {}) {
    const roomInfoRoom = roomInfo?.data?.room_info || {}
    const roomId = normalizeRoomId(
        liveRoom?.roomid,
        liveRoom?.room_id,
        cachedRoomId,
        roomInfoRoom?.room_id,
        roomInfoRoom?.roomid
    )
    const roomUrl = buildRoomUrl(
        roomId,
        liveRoom?.url,
        roomInfoRoom?.url
    )

    const primaryStatus = normalizeLiveStatus(
        liveRoom?.liveStatus ?? liveRoom?.live_status
    )
    if (primaryStatus === 1) {
        return { status: 'online', roomId, roomUrl }
    }
    if (primaryStatus === 0) {
        return { status: 'offline', roomId, roomUrl }
    }

    const fallbackStatus = roomInfo?.status === 'success'
        ? normalizeLiveStatus(roomInfoRoom?.live_status ?? roomInfoRoom?.liveStatus)
        : null
    if (fallbackStatus === 1) {
        return { status: 'online', roomId, roomUrl }
    }
    if (fallbackStatus === 0) {
        return { status: 'offline', roomId, roomUrl }
    }

    return { status: 'unknown', roomId, roomUrl }
}

module.exports = {
    resolveLiveState,
    normalizeLiveStatus,
    normalizeRoomId
}
