const express = require('express')
const longTermStore = require('../../../../agent/memory/longTermStore')
const { dashLog } = require('../shared/logging')

const router = express.Router()

function parseLimit(value) {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) return 50
    return Math.max(1, Math.min(200, parsed))
}

router.get('/agent/memories', async (req, res) => {
    try {
        const memories = await longTermStore.listMemories({
            groupId: req.query.groupId ? String(req.query.groupId).trim() : '',
            userId: req.query.userId ? String(req.query.userId).trim() : '',
            limit: parseLimit(req.query.limit)
        })
        res.json({ memories })
    } catch (error) {
        dashLog(req, 'error', 'agent-memory-list-failed', {
            error: error.message
        })
        res.status(500).json({ error: 'Failed to list agent memories' })
    }
})

router.delete('/agent/memories/:id', async (req, res) => {
    try {
        const deleted = await longTermStore.deleteMemory(req.params.id)
        if (!deleted) {
            return res.status(404).json({ error: 'Memory not found' })
        }
        res.json({ message: 'Memory deleted' })
    } catch (error) {
        dashLog(req, 'error', 'agent-memory-delete-failed', {
            memoryId: req.params.id,
            error: error.message
        })
        res.status(500).json({ error: 'Failed to delete agent memory' })
    }
})

router.post('/agent/memories/clear', async (req, res) => {
    try {
        const groupId = req.body?.groupId ? String(req.body.groupId).trim() : ''
        const userId = req.body?.userId ? String(req.body.userId).trim() : ''
        if (!groupId && !userId) {
            return res.status(400).json({ error: 'groupId or userId is required' })
        }
        const removed = await longTermStore.clearMemories({ groupId, userId })
        res.json({ message: 'Memories cleared', removed })
    } catch (error) {
        dashLog(req, 'error', 'agent-memory-clear-failed', {
            error: error.message
        })
        res.status(500).json({ error: 'Failed to clear agent memories' })
    }
})

module.exports = router
