const { notificationService, config, logger } = require('../adapters/deps')
const { VALID_AT_ALL_CATEGORIES } = require('../constants')
const { normalizeSourceList } = require('../helpers/sourceMap')
const { toUidString } = require('../helpers/ids')

module.exports = {
    isSubscriptionAtAllEnabled(groupId) {
        return config.getGroupConfig(groupId, 'subscriptionAtAll') === true
    },

    getSubscriptionAtAllRules(groupId) {
        const rules = config.getGroupConfig(groupId, 'subscriptionAtAllRules')
        return config.normalizeSubscriptionAtAllRules(rules)
    },

    resolveContentSubtype(type, data) {
        let subtype = type

        if (type === 'bangumi') {
            const seasonType = data?.season_type ?? data?.data?.season_type
            if (seasonType === 2) subtype = 'movie'
            else if (seasonType === 3) subtype = 'doc'
            else if (seasonType === 4) subtype = 'guocha'
            else if (seasonType === 5) subtype = 'tv'
            else if (seasonType === 7) subtype = 'variety'
        } else if (type === 'dynamic' && data && data.item && data.item.desc) {
            if (data.item.desc.type === 8) subtype = 'video'
            else if (data.item.desc.type === 64) subtype = 'article'
        }

        return subtype
    },

    resolveAtAllCategory(type, data) {
        const subtype = this.resolveContentSubtype(type, data)
        if (VALID_AT_ALL_CATEGORIES.has(subtype)) return subtype

        if (subtype === 'forward') return 'dynamic'
        if (type === 'bangumi') return 'bangumi'
        if (type === 'live') return 'live'
        if (type === 'video') return 'video'
        if (type === 'article') return 'article'
        return 'dynamic'
    },

    buildAtAllMetaForGroup(groupId, groupSourceMap, rawMeta = {}, type = null, data = null) {
        const gid = String(groupId)
        const sourcesFromMap = groupSourceMap instanceof Map && groupSourceMap.has(gid)
            ? normalizeSourceList(Array.from(groupSourceMap.get(gid) || []))
            : []
        const sourcesFromMeta = normalizeSourceList(rawMeta?.sources || rawMeta?.fallbackSources || ['manual', 'cookieSync'])
        const sources = sourcesFromMap.length > 0 ? sourcesFromMap : sourcesFromMeta

        const categoryFromMeta = String(rawMeta?.category || '').trim()
        const category = VALID_AT_ALL_CATEGORIES.has(categoryFromMeta)
            ? categoryFromMeta
            : (type ? this.resolveAtAllCategory(type, data) : null)

        const actorUid = toUidString(rawMeta?.actorUid)

        return {
            sources,
            category,
            actorUid
        }
    },

    shouldAtAll(groupId, meta = {}) {
        const rules = this.getSubscriptionAtAllRules(groupId)
        const sources = normalizeSourceList(meta.sources)
        const effectiveSources = sources.length > 0 ? sources : ['manual', 'cookieSync']
        const category = String(meta.category || '').trim()
        const actorUid = toUidString(meta.actorUid)

        if (category && VALID_AT_ALL_CATEGORIES.has(category) && rules.categories[category] === false) {
            return false
        }

        for (const source of effectiveSources) {
            if (rules.sources[source] !== true) continue

            if (actorUid) {
                const disabledIds = source === 'cookieSync'
                    ? rules.cookieSyncDisabledIds
                    : rules.manualDisabledIds
                if (Array.isArray(disabledIds) && disabledIds.includes(actorUid)) {
                    continue
                }
            }

            return true
        }

        return false
    },

    getSubscriptionAtAllWarmupGroups() {
        const result = []
        const groupConfigs = config.groupConfigs || {}

        for (const [groupId, groupConfig] of Object.entries(groupConfigs)) {
            if (!groupConfig || groupConfig.isInGroup === false) continue
            if (!config.isGroupEnabled(groupId)) continue
            if (!this.isSubscriptionAtAllEnabled(groupId)) continue
            result.push(String(groupId))
        }

        return result
    },

    async warmupGroupAtAllCapabilities(forceRefresh = true) {
        const groupIds = this.getSubscriptionAtAllWarmupGroups()
        if (groupIds.length === 0) return

        logger.info(`[UpdateChecker] Pre-checking @all capability for ${groupIds.length} groups at startup`)
        const batchSize = this.AT_ALL_CAPABILITY_WARMUP_BATCH_SIZE

        for (let i = 0; i < groupIds.length; i += batchSize) {
            const batch = groupIds.slice(i, i + batchSize)
            await Promise.all(batch.map(gid => this.queryGroupAtAllCapability(gid, { forceRefresh })))
        }
    },

    markGroupAtAllUnavailable(groupId, reason = 'unknown', retcode = null, ttlMs = this.AT_ALL_SEND_FAILURE_CACHE_TTL_MS) {
        const cacheKey = String(groupId)
        const now = Date.now()
        this.groupAtAllCapabilityCache.set(cacheKey, {
            canAtAll: false,
            reason,
            retcode,
            expiresAt: now + Math.max(0, Number(ttlMs) || 0)
        })
    },

    async resolveBotSelfId() {
        const selfId = String(global?.bot?.selfId || '')
        if (selfId && selfId !== '0') {
            return selfId
        }

        if (!this.ws) return null

        try {
            const response = await notificationService.callAction(
                this.ws,
                'get_login_info',
                {},
                'UpdateChecker',
                4000
            )
            const uid = response?.data?.user_id
            if (uid === undefined || uid === null) return null
            const resolved = String(uid)
            global.bot = global.bot || {}
            global.bot.selfId = resolved
            return resolved
        } catch {
            return null
        }
    },

    async queryBotGroupRole(groupId, options = {}) {
        const { forceRefresh = false } = options
        const cacheKey = String(groupId)
        const now = Date.now()
        const cached = this.groupBotRoleCache.get(cacheKey)

        if (!forceRefresh && cached && cached.expiresAt > now) {
            return cached
        }

        if (this.groupBotRoleInFlight.has(cacheKey)) {
            return this.groupBotRoleInFlight.get(cacheKey)
        }

        const queryPromise = (async () => {
            const result = {
                role: null,
                allowed: false,
                reason: 'unknown',
                retcode: null,
                expiresAt: now + this.AT_ALL_CAPABILITY_CACHE_TTL_MS
            }

            if (!this.ws) {
                result.reason = 'ws_unavailable'
                this.groupBotRoleCache.set(cacheKey, result)
                return result
            }

            const selfId = await this.resolveBotSelfId()
            if (!selfId) {
                result.reason = 'self_id_unavailable'
                this.groupBotRoleCache.set(cacheKey, result)
                return result
            }

            try {
                const response = await notificationService.callAction(
                    this.ws,
                    'get_group_member_info',
                    {
                        group_id: groupId,
                        user_id: Number(selfId),
                        no_cache: true
                    },
                    'UpdateChecker',
                    4000
                )

                result.retcode = response?.retcode ?? null

                if (response?.status === 'ok') {
                    const role = String(response?.data?.role || '').toLowerCase()
                    result.role = role || null
                    result.allowed = role === 'admin' || role === 'owner'
                    result.reason = result.allowed
                        ? 'ok'
                        : `insufficient_role:${role || 'unknown'}`
                } else {
                    const wording = response?.wording || response?.message
                    result.reason = wording ? `action_failed:${wording}` : 'action_failed'
                }
            } catch (e) {
                result.reason = `query_failed:${e.message}`
            }

            this.groupBotRoleCache.set(cacheKey, result)
            return result
        })()

        this.groupBotRoleInFlight.set(cacheKey, queryPromise)
        try {
            return await queryPromise
        } finally {
            this.groupBotRoleInFlight.delete(cacheKey)
        }
    },

    async queryGroupAtAllCapability(groupId, options = {}) {
        const { forceRefresh = false } = options
        const cacheKey = String(groupId)
        const now = Date.now()
        const cached = this.groupAtAllCapabilityCache.get(cacheKey)

        if (!forceRefresh && cached && cached.expiresAt > now) {
            return cached
        }

        if (this.groupAtAllCapabilityInFlight.has(cacheKey)) {
            return this.groupAtAllCapabilityInFlight.get(cacheKey)
        }

        const queryPromise = (async () => {
            const result = {
                canAtAll: false,
                reason: 'unknown',
                retcode: null,
                botRole: null,
                expiresAt: now + this.AT_ALL_CAPABILITY_CACHE_TTL_MS
            }

            if (!this.ws) {
                result.reason = 'ws_unavailable'
                this.groupAtAllCapabilityCache.set(cacheKey, result)
                return result
            }

            try {
                const response = await notificationService.callAction(
                    this.ws,
                    'get_group_at_all_remain',
                    { group_id: groupId },
                    'UpdateChecker',
                    4000
                )

                result.retcode = response?.retcode ?? null

                if (response?.status === 'ok') {
                    const data = response?.data || {}
                    if (typeof data.can_at_all === 'boolean') {
                        result.canAtAll = data.can_at_all
                    } else {
                        const remainForUin = Number(data.remain_at_all_count_for_uin)
                        const remainForGroup = Number(data.remain_at_all_count_for_group)
                        const validUinRemain = Number.isFinite(remainForUin)
                        const validGroupRemain = Number.isFinite(remainForGroup)

                        if (validUinRemain && validGroupRemain) {
                            result.canAtAll = remainForUin > 0 && remainForGroup > 0
                        } else if (validUinRemain) {
                            result.canAtAll = remainForUin > 0
                        } else {
                            result.canAtAll = false
                        }
                    }

                    if (!result.canAtAll) {
                        result.reason = 'no_permission_or_quota'
                    } else {
                        const roleState = await this.queryBotGroupRole(groupId, { forceRefresh })
                        result.botRole = roleState.role
                        if (roleState.allowed) {
                            result.reason = 'ok'
                        } else {
                            result.canAtAll = false
                            result.reason = roleState.reason
                        }
                    }
                } else {
                    const wording = response?.wording || response?.message
                    result.reason = wording ? `action_failed:${wording}` : 'action_failed'
                }
            } catch (e) {
                result.reason = `query_failed:${e.message}`
            }

            this.groupAtAllCapabilityCache.set(cacheKey, result)

            if (!result.canAtAll) {
                logger.info(`[UpdateChecker] Group ${groupId} @all unavailable, fallback to plain message (reason: ${result.reason}, retcode: ${result.retcode ?? 'N/A'})`)
            }

            return result
        })()

        this.groupAtAllCapabilityInFlight.set(cacheKey, queryPromise)
        try {
            return await queryPromise
        } finally {
            this.groupAtAllCapabilityInFlight.delete(cacheKey)
        }
    },

    async buildSubscriptionMessageChain(groupId, messageChain, atAllMeta = {}) {
        if (!this.isSubscriptionAtAllEnabled(groupId)) {
            return messageChain
        }

        if (!this.shouldAtAll(groupId, atAllMeta)) {
            return messageChain
        }

        const capability = await this.queryGroupAtAllCapability(groupId)
        if (!capability.canAtAll) {
            return messageChain
        }

        return [{ type: 'at', data: { qq: 'all' } }, ...messageChain]
    },

    async sendGroupMessageByAction(groupId, messageChain) {
        try {
            const response = await notificationService.callAction(
                this.ws,
                'send_group_msg',
                { group_id: groupId, message: messageChain },
                'UpdateChecker',
                10000
            )

            const status = response?.status
            const retcode = response?.retcode ?? null
            const isOk = status === 'ok' && (retcode === null || retcode === 0)
            const wording = response?.wording || response?.message || ''

            return {
                ok: isOk,
                reason: isOk ? 'ok' : (wording ? `action_failed:${wording}` : 'action_failed'),
                retcode
            }
        } catch (e) {
            return { ok: false, reason: `send_failed:${e.message}`, retcode: null }
        }
    },

    hasAtAllSegment(messageChain) {
        if (!Array.isArray(messageChain)) return false
        return messageChain.some(seg => seg?.type === 'at' && String(seg?.data?.qq) === 'all')
    },

    async sendSubscriptionMessage(groupId, baseMessageChain, atAllMeta = {}) {
        if (!this.ws) return

        try {
            const processedBaseMessageChain = notificationService.processMessageChain(baseMessageChain, 'UpdateChecker')
            const messageChain = await this.buildSubscriptionMessageChain(groupId, processedBaseMessageChain, atAllMeta)

            const firstSendResult = await this.sendGroupMessageByAction(groupId, messageChain)
            if (firstSendResult.ok) {
                return
            }

            if (this.hasAtAllSegment(messageChain)) {
                this.markGroupAtAllUnavailable(groupId, firstSendResult.reason, firstSendResult.retcode)
                logger.warn(
                    `[UpdateChecker] send_group_msg with @all failed for group ${groupId}, retrying without @all ` +
                    `(reason: ${firstSendResult.reason}, retcode: ${firstSendResult.retcode ?? 'N/A'})`
                )

                const retryResult = await this.sendGroupMessageByAction(groupId, processedBaseMessageChain)
                if (retryResult.ok) {
                    logger.info(`[UpdateChecker] Fallback to plain message succeeded for group ${groupId}`)
                    return
                }

                throw new Error(
                    `send_group_msg failed after @all fallback: ` +
                    `${firstSendResult.reason} -> ${retryResult.reason}`
                )
            }

            throw new Error(`send_group_msg failed: ${firstSendResult.reason}`)
        } catch (e) {
            logger.error(`[UpdateChecker] Failed to send subscription message to group ${groupId}:`, e)
            notificationService.sendGroupMessage(this.ws, groupId, baseMessageChain)
        }
    }
}
