const express = require('express')
const sysConfig = require('../../../../config')
const { normalizeBlacklist, normalizeQQ } = require('../shared/normalize')

const router = express.Router()

// GET /api/blacklist/global - Get global blacklist
router.get('/blacklist/global', async (req, res) => {
    try {
        const original = Array.isArray(sysConfig.blacklistedQQs)
            ? sysConfig.blacklistedQQs
            : []
        const normalized = normalizeBlacklist(original)
        const changed =
            original.length !== normalized.length ||
            original.some((q, i) => String(q) !== normalized[i])

        if (changed) {
            sysConfig.blacklistedQQs = normalized
            sysConfig.save()
        }

        res.json(normalized)
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch blacklist' })
    }
})

// POST /api/blacklist/global - Add to global blacklist
router.post('/blacklist/global', async (req, res) => {
    try {
        const { qq } = req.body
        const qqToStore = normalizeQQ(qq)
        if (!qqToStore) {
            return res.status(400).json({ error: 'Missing QQ number' })
        }

        sysConfig.blacklistedQQs = normalizeBlacklist(sysConfig.blacklistedQQs)

        if (!sysConfig.blacklistedQQs.includes(qqToStore)) {
            sysConfig.blacklistedQQs.push(qqToStore)
            sysConfig.save()
        }

        res.json({ message: 'Added to blacklist', blacklist: sysConfig.blacklistedQQs })
    } catch (error) {
        res.status(500).json({ error: 'Failed to update blacklist' })
    }
})

// DELETE /api/blacklist/global/:qq - Remove from global blacklist
router.delete('/blacklist/global/:qq', async (req, res) => {
    try {
        const qqToRemove = normalizeQQ(req.params.qq)
        if (!qqToRemove) {
            return res.status(400).json({ error: 'Missing QQ number' })
        }

        const normalized = normalizeBlacklist(sysConfig.blacklistedQQs)
        const filtered = normalized.filter(q => q !== qqToRemove)

        if (filtered.length !== normalized.length) {
            sysConfig.blacklistedQQs = filtered
            sysConfig.save()
        }

        res.json({ message: 'Removed from blacklist', blacklist: filtered })
    } catch (error) {
        res.status(500).json({ error: 'Failed to update blacklist' })
    }
})

module.exports = router

