'use strict'

const express = require('express')
const defaultConfig = require('../../../../config')
const { normalizeBlacklist, normalizeQQ } = require('../shared/normalize')
const { dashLog } = require('../shared/logging')
const {
    assertExpectedGeneration,
    assertCurrentGeneration,
    configErrorResponse,
    configErrorStatus,
    emptyMutationResult
} = require('../shared/config-mutation')

function getBlacklist(config) {
    const snapshot = typeof config.getSnapshot === 'function' ? config.getSnapshot() : null
    return normalizeBlacklist(snapshot?.blacklistedQQs ?? config.blacklistedQQs)
}

function createBlacklistRouter(options = {}) {
    const config = options.config || defaultConfig
    const router = express.Router()

    router.get('/blacklist/global', async (req, res) => {
        try {
            res.json(getBlacklist(config))
        } catch (error) {
            dashLog(req, 'error', 'global-blacklist-fetch-failed', { code: error?.code || 'CONFIG_ERROR' })
            res.status(500).json(configErrorResponse(config, error))
        }
    })

    router.post('/blacklist/global', async (req, res) => {
        try {
            const expectedGeneration = assertExpectedGeneration(req.body?.expectedGeneration)
            const qqToStore = normalizeQQ(req.body?.qq)
            if (!qqToStore) return res.status(400).json({ error: 'Missing QQ number' })
            const current = getBlacklist(config)
            const next = current.includes(qqToStore) ? current : [...current, qqToStore]
            assertCurrentGeneration(config, expectedGeneration)
            const result = next.length === current.length
                ? emptyMutationResult(config)
                : await config.patch([
                    { op: 'set', path: ['blacklistedQQs'], value: next }
                ], { actor: 'dashboard', expectedGeneration })
            res.json({ ...result, message: 'Added to blacklist', blacklist: next })
        } catch (error) {
            const payload = configErrorResponse(config, error)
            const code = configErrorStatus(error)
            dashLog(req, code >= 500 ? 'error' : 'warn', 'global-blacklist-update-failed', { code: payload.code })
            res.status(code).json(payload)
        }
    })

    router.delete('/blacklist/global/:qq', async (req, res) => {
        try {
            const expectedGeneration = assertExpectedGeneration(req.body?.expectedGeneration)
            const qqToRemove = normalizeQQ(req.params.qq)
            if (!qqToRemove) return res.status(400).json({ error: 'Missing QQ number' })
            const current = getBlacklist(config)
            const next = current.filter((qq) => qq !== qqToRemove)
            assertCurrentGeneration(config, expectedGeneration)
            const result = next.length === current.length
                ? emptyMutationResult(config)
                : await config.patch([
                    { op: 'set', path: ['blacklistedQQs'], value: next }
                ], { actor: 'dashboard', expectedGeneration })
            res.json({ ...result, message: 'Removed from blacklist', blacklist: next })
        } catch (error) {
            const payload = configErrorResponse(config, error)
            const code = configErrorStatus(error)
            dashLog(req, code >= 500 ? 'error' : 'warn', 'global-blacklist-update-failed', { code: payload.code })
            res.status(code).json(payload)
        }
    })

    return router
}

const router = createBlacklistRouter()

module.exports = router
module.exports.createBlacklistRouter = createBlacklistRouter
