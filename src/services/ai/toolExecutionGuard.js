'use strict'

class ToolExecutionGuard {
    constructor(options = {}) {
        const timeoutMs = parseInt(options.timeoutMs ?? process.env.AI_TOOL_TIMEOUT_MS ?? '10000', 10)
        const failureThreshold = parseInt(options.failureThreshold ?? process.env.AI_TOOL_FAILURE_THRESHOLD ?? '3', 10)
        const cooldownMs = parseInt(options.cooldownMs ?? process.env.AI_TOOL_COOLDOWN_MS ?? '60000', 10)

        this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000
        this.failureThreshold = Number.isFinite(failureThreshold) && failureThreshold > 0 ? failureThreshold : 3
        this.cooldownMs = Number.isFinite(cooldownMs) && cooldownMs > 0 ? cooldownMs : 60000
        this.toolStates = new Map()
    }

    _getState(toolName) {
        if (!this.toolStates.has(toolName)) {
            this.toolStates.set(toolName, {
                consecutiveFailures: 0,
                blockedUntil: 0,
                lastErrorAt: 0
            })
        }
        return this.toolStates.get(toolName)
    }

    getToolState(toolName) {
        const state = this._getState(toolName)
        return {
            consecutiveFailures: state.consecutiveFailures,
            blockedUntil: state.blockedUntil,
            lastErrorAt: state.lastErrorAt
        }
    }

    _isCircuitOpen(toolName) {
        const state = this._getState(toolName)
        return state.blockedUntil > Date.now()
    }

    _recordFailure(toolName) {
        const state = this._getState(toolName)
        state.consecutiveFailures += 1
        state.lastErrorAt = Date.now()
        if (state.consecutiveFailures >= this.failureThreshold) {
            state.blockedUntil = Date.now() + this.cooldownMs
            return true
        }
        return false
    }

    _recordSuccess(toolName) {
        const state = this._getState(toolName)
        state.consecutiveFailures = 0
        state.blockedUntil = 0
    }

    async execute(toolName, fn) {
        if (this._isCircuitOpen(toolName)) {
            return {
                ok: false,
                reason: 'circuit_open',
                timedOut: false,
                error: new Error(`Circuit open for tool ${toolName}`)
            }
        }

        let timer = null
        let controller = null
        try {
            if (typeof AbortController !== 'undefined') {
                controller = new AbortController()
            }

            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    const timeoutError = new Error(`Tool ${toolName} timed out after ${this.timeoutMs}ms`)
                    timeoutError.code = 'TOOL_TIMEOUT'
                    if (controller && !controller.signal.aborted) {
                        controller.abort(timeoutError)
                    }
                    reject(timeoutError)
                }, this.timeoutMs)
                if (typeof timer.unref === 'function') {
                    timer.unref()
                }
            })

            const value = await Promise.race([
                Promise.resolve().then(() => fn({
                    signal: controller ? controller.signal : undefined,
                    timeoutMs: this.timeoutMs
                })),
                timeoutPromise
            ])
            this._recordSuccess(toolName)
            return {
                ok: true,
                value
            }
        } catch (error) {
            const circuitOpened = this._recordFailure(toolName)
            const timedOut = !!(
                (error && error.code === 'TOOL_TIMEOUT') ||
                (controller && controller.signal.aborted && controller.signal.reason && controller.signal.reason.code === 'TOOL_TIMEOUT')
            )
            return {
                ok: false,
                reason: timedOut ? 'timeout' : 'error',
                timedOut,
                circuitOpened,
                error
            }
        } finally {
            if (timer) clearTimeout(timer)
        }
    }
}

module.exports = {
    ToolExecutionGuard,
    toolExecutionGuard: new ToolExecutionGuard()
}
