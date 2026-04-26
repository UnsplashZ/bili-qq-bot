const fs = require('fs')
const path = require('path')
const logger = require('../../utils/logger')
const { buildNativeTrajectorySpans } = require('./trajectorySpans')

const RUNS_DIR = path.join(__dirname, '../../../data/agent/runs')

function pad2(value) {
    return String(value).padStart(2, '0')
}

function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function redactText(text) {
    const value = String(text || '')
    if (value.length <= 80) return value
    return `${value.slice(0, 77)}...`
}

async function recordTrajectory(event) {
    try {
        await fs.promises.mkdir(RUNS_DIR, { recursive: true })
        const filePath = path.join(RUNS_DIR, `${dateKey()}.jsonl`)
        const payload = {
            ...event,
            rawTextPreview: redactText(event.rawTextPreview),
            spans: Array.isArray(event.spans) ? event.spans : buildNativeTrajectorySpans(event),
            recordedAt: new Date().toISOString()
        }
        await fs.promises.appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8')
    } catch (error) {
        logger.logEvent('warn', 'AGENT', event.traceScope || '', 'trajectory-write-failed', {
            error: logger.getErrorMessage(error)
        })
    }
}

module.exports = {
    recordTrajectory,
    RUNS_DIR
}
