const fs = require('fs')
const path = require('path')
const logger = require('../../utils/logger')

const AUDIT_DIR = path.join(__dirname, '../../../data/agent/audit')
const AUDIT_FILE = path.join(AUDIT_DIR, 'tool-audit.jsonl')

async function recordToolAudit(event) {
    const payload = {
        timestamp: new Date().toISOString(),
        ...event
    }
    try {
        await fs.promises.mkdir(AUDIT_DIR, { recursive: true })
        await fs.promises.appendFile(AUDIT_FILE, `${JSON.stringify(payload)}\n`, 'utf8')
    } catch (error) {
        logger.logEvent('warn', 'AGENT', event?.traceScope || '', 'tool-audit-write-failed', {
            error: logger.getErrorMessage(error)
        })
    }
}

module.exports = {
    recordToolAudit
}
