const { OfficialOpenApiError } = require('./errors')

function cleanText(value) {
    return String(value || '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, '')
        .replace(/\uFFFD/g, '')
}

function normalizeChain(message) {
    if (Array.isArray(message)) return message.filter((item) => item && typeof item === 'object')
    return [{ type: 'text', data: { text: String(message || '') } }]
}

function getSegmentText(segment) {
    if (!segment) return ''
    if (segment.type === 'text') return cleanText(segment.data?.text || '')
    if (segment.type === 'at') {
        const qq = String(segment.data?.qq || '')
        return qq === 'all' ? '' : ''
    }
    return ''
}

function getMediaKind(segment) {
    const type = String(segment?.type || '').toLowerCase()
    if (type === 'image') return 'image'
    if (type === 'video') return 'video'
    return ''
}

class OfficialMessageSender {
    constructor(options = {}) {
        this.client = options.client
        this.mediaUploader = options.mediaUploader
        this.rateLimiter = options.rateLimiter
        this.messageIdStore = options.messageIdStore
        this.logger = options.logger || null
    }

    buildMessageBody({ targetType, targetId, content = '', metadata = {}, msgType = 0, media = null }) {
        const body = { msg_type: msgType }
        if (content) body.content = content
        if (media) body.media = media

        if (metadata.msgId) {
            body.msg_id = metadata.msgId
            if (metadata.msgSeq !== undefined && metadata.msgSeq !== null && metadata.msgSeq !== '') {
                body.msg_seq = Number(metadata.msgSeq)
            }
        } else if (metadata.eventId) {
            body.event_id = metadata.eventId
            if (metadata.msgSeq !== undefined && metadata.msgSeq !== null && metadata.msgSeq !== '') {
                body.msg_seq = Number(metadata.msgSeq)
            }
        } else {
            body.msg_seq = this.messageIdStore.nextSeq(targetType, targetId)
        }
        return body
    }

    async sendBody({ targetType, targetId, body }) {
        const groupId = targetType === 'group' ? targetId : ''
        const run = async () => {
            return targetType === 'private'
                ? await this.client.sendC2CMessage(targetId, body)
                : await this.client.sendGroupMessage(targetId, body)
        }
        return this.rateLimiter.schedule(run, { groupId })
    }

    recordSentMessage(targetType, targetId, response = {}) {
        const messageId = response.id || response.message_id || response.msg_id || response.data?.id || response.data?.message_id
        const record = this.messageIdStore.record({
            officialMessageId: messageId || `sent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            targetType,
            targetId,
            raw: response
        })
        return {
            status: 'ok',
            retcode: 0,
            data: {
                message_id: record.internalMessageId,
                official_message_id: record.officialMessageId
            },
            raw: response
        }
    }

    buildSequencedMetadata(metadata = {}, sendIndex = 0) {
        const hasPassiveId = Boolean(metadata.msgId || metadata.eventId)
        if (!hasPassiveId) return metadata
        const next = { ...metadata }
        const baseSeq = Number(metadata.msgSeq)
        next.msgSeq = Number.isFinite(baseSeq) && baseSeq > 0
            ? baseSeq + sendIndex
            : sendIndex + 1
        return next
    }

    async sendText({ targetType, targetId, text, metadata = {} }) {
        const content = cleanText(text)
        if (!content) {
            return { status: 'ok', retcode: 0, data: { message_id: '' }, skipped: true }
        }
        const body = this.buildMessageBody({
            targetType,
            targetId,
            content,
            metadata,
            msgType: 0
        })
        const response = await this.sendBody({ targetType, targetId, body })
        return this.recordSentMessage(targetType, targetId, response)
    }

    async sendMedia({ targetType, targetId, segment, mediaKind, metadata = {} }) {
        const groupId = targetType === 'group' ? targetId : ''
        const upload = await this.rateLimiter.schedule(() => this.mediaUploader.upload({
            targetType,
            targetId,
            segment,
            mediaKind,
            metadata
        }), { groupId })
        const fileInfo = upload.file_info || upload.fileInfo || upload.data?.file_info || upload.data?.fileInfo
        if (!fileInfo) throw new Error('official_media_upload_missing_file_info')
        const body = this.buildMessageBody({
            targetType,
            targetId,
            media: { file_info: fileInfo },
            metadata,
            msgType: 7
        })
        const response = await this.sendBody({ targetType, targetId, body })
        return this.recordSentMessage(targetType, targetId, response)
    }

    async sendMessage({ targetType, targetId, message, metadata = {}, enableMediaFallback = true }) {
        const chain = normalizeChain(message)
        const results = []
        let pendingText = ''
        let sendIndex = 0

        for (const segment of chain) {
            const mediaKind = getMediaKind(segment)
            if (!mediaKind) {
                const text = getSegmentText(segment)
                if (text) pendingText += text
                continue
            }

            if (pendingText) {
                const partMetadata = this.buildSequencedMetadata(metadata, sendIndex)
                sendIndex += 1
                results.push(await this.sendText({ targetType, targetId, text: pendingText, metadata: partMetadata }))
                pendingText = ''
            }

            try {
                const partMetadata = this.buildSequencedMetadata(metadata, sendIndex)
                sendIndex += 1
                results.push(await this.sendMedia({ targetType, targetId, segment, mediaKind, metadata: partMetadata }))
            } catch (error) {
                if (!enableMediaFallback) throw error
                const fallbackText = mediaKind === 'video'
                    ? '视频发送失败，已降级为文本提示。'
                    : '图片发送失败，已降级为文本提示。'
                this.logger?.logEvent?.('warn', 'QQ', 'svc:qq:send', 'media-send-fallback', {
                    targetType,
                    targetId,
                    mediaKind,
                    error: this.logger.getErrorMessage ? this.logger.getErrorMessage(error) : String(error)
                })
                const fallbackMetadata = this.buildSequencedMetadata(metadata, sendIndex)
                sendIndex += 1
                const fallbackResult = await this.sendText({
                    targetType,
                    targetId,
                    text: fallbackText,
                    metadata: fallbackMetadata
                })
                fallbackResult.fallbackUsed = true
                fallbackResult.fallbackReason = mediaKind === 'video' ? 'video_media_send_failed' : 'image_media_send_failed'
                results.push(fallbackResult)
            }
        }

        if (pendingText) {
            const partMetadata = this.buildSequencedMetadata(metadata, sendIndex)
            sendIndex += 1
            results.push(await this.sendText({ targetType, targetId, text: pendingText, metadata: partMetadata }))
        }

        if (results.length === 0) {
            return { status: 'ok', retcode: 0, data: { message_id: '' }, skipped: true }
        }
        return results[results.length - 1]
    }

    sendGroupMessage(groupOpenId, message, metadata = {}) {
        return this.sendMessage({
            targetType: 'group',
            targetId: String(groupOpenId || ''),
            message,
            metadata
        })
    }

    sendPrivateMessage(userOpenId, message, metadata = {}) {
        return this.sendMessage({
            targetType: 'private',
            targetId: String(userOpenId || ''),
            message,
            metadata
        })
    }

    async recallMessage(messageId, options = {}) {
        const record = this.messageIdStore.resolve(messageId)
        if (!record?.officialMessageId) throw new Error('official_message_id_unavailable')
        const targetType = options.targetType || record.targetType || (options.groupId ? 'group' : 'private')
        const targetId = options.targetId || options.groupId || options.userId || record.targetId
        if (!targetId) throw new Error('official_message_target_unavailable')

        const run = () => targetType === 'private'
            ? this.client.recallC2CMessage(targetId, record.officialMessageId, options)
            : this.client.recallGroupMessage(targetId, record.officialMessageId, options)
        const response = await this.rateLimiter.schedule(run, {
            groupId: targetType === 'group' ? targetId : ''
        })
        return {
            status: 'ok',
            retcode: 0,
            data: {
                message_id: record.internalMessageId,
                official_message_id: record.officialMessageId
            },
            raw: response
        }
    }
}

module.exports = OfficialMessageSender
module.exports.normalizeChain = normalizeChain
