const express = require('express')
const si = require('systeminformation')
const logger = require('../../../../utils/logger')

const router = express.Router()

// POST /api/restart - Trigger graceful restart
router.post('/restart', async (req, res) => {
    res.json({ message: 'Restarting application...' })

    setTimeout(() => {
        logger.info('Restart triggered via API')
        process.exit(0)
    }, 1000)
})

// GET /api/monitor - System stats
router.get('/monitor', async (req, res) => {
    try {
        const defaultIface = await si.networkInterfaceDefault().catch(() => null)

        const [cpu, mem, network] = await Promise.all([
            si.currentLoad(),
            si.mem(),
            si.networkStats(defaultIface || undefined),
            si.time()
        ])

        const processUptime = process.uptime()

        let rx_sec = 0
        let tx_sec = 0

        if (Array.isArray(network)) {
            network.forEach(iface => {
                rx_sec += iface.rx_sec || 0
                tx_sec += iface.tx_sec || 0
            })
        } else if (network) {
            rx_sec = network.rx_sec || 0
            tx_sec = network.tx_sec || 0
        }

        const stats = {
            cpu: cpu.currentLoad,
            memory: {
                used: mem.active,
                total: mem.total
            },
            network: {
                up: tx_sec,
                down: rx_sec
            },
            uptime: processUptime
        }

        res.json(stats)
    } catch (error) {
        logger.error('Error fetching system stats:', error)
        res.status(500).json({ error: 'Failed to fetch system stats' })
    }
})

module.exports = router

