const express = require('express');
const { logBuffer } = require('../../../logBuffer');

const router = express.Router();

router.get('/logs/recent', (req, res) => {
    const channels = req.query.channels
        ? String(req.query.channels)
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined

    const limit = req.query.limit ? Number.parseInt(req.query.limit, 10) : undefined
    const logs = logBuffer.list({
        level: req.query.level,
        channels,
        keyword: req.query.keyword,
        limit
    })

    res.json({ logs });
});

module.exports = router;
