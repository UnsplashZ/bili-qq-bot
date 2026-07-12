'use strict'

class ApplicationAdmissionError extends Error {
    constructor(reason = 'configuration reload') {
        super(`Application ingress is paused: ${reason}`)
        this.code = 'APPLICATION_INGRESS_PAUSED'
        this.statusCode = 503
        this.reason = String(reason)
    }
}

class ApplicationAdmissionGate {
    constructor() {
        this.closed = false
        this.reason = null
        this.sequence = 0
        this.activeToken = null
        this.openCallbacks = new Set()
        this.callbackFailureCount = 0
    }

    close(reason = 'configuration reload') {
        if (this.closed) {
            const error = new Error('Application admission gate is already closed')
            error.code = 'APPLICATION_ADMISSION_ALREADY_CLOSED'
            throw error
        }
        const token = Object.freeze({ sequence: ++this.sequence })
        this.closed = true
        this.reason = String(reason)
        this.activeToken = token
        return token
    }

    open(token) {
        if (!this.closed) {
            const error = new Error('Application admission gate is not closed')
            error.code = 'APPLICATION_ADMISSION_NOT_CLOSED'
            throw error
        }
        if (!token || token !== this.activeToken) {
            const error = new Error('Application admission gate token is stale')
            error.code = 'APPLICATION_ADMISSION_TOKEN_STALE'
            throw error
        }
        this.closed = false
        this.reason = null
        this.activeToken = null
        const callbacks = [...this.openCallbacks]
        this.openCallbacks.clear()
        for (const callback of callbacks) {
            queueMicrotask(() => {
                try {
                    Promise.resolve(callback()).catch(() => { this.callbackFailureCount += 1 })
                } catch {
                    this.callbackFailureCount += 1
                }
            })
        }
        return true
    }

    runWhenOpen(callback) {
        if (typeof callback !== 'function') throw new TypeError('Admission callback must be a function')
        if (this.closed) {
            this.openCallbacks.add(callback)
            return () => this.openCallbacks.delete(callback)
        }
        queueMicrotask(() => {
            try {
                Promise.resolve(callback()).catch(() => { this.callbackFailureCount += 1 })
            } catch {
                this.callbackFailureCount += 1
            }
        })
        return () => false
    }

    assertOpen() {
        if (this.closed) throw new ApplicationAdmissionError(this.reason)
        return true
    }

    snapshot() {
        return {
            closed: this.closed,
            reason: this.reason,
            sequence: this.sequence,
            pendingOpenCallbacks: this.openCallbacks.size,
            callbackFailureCount: this.callbackFailureCount
        }
    }
}

const applicationAdmissionGate = new ApplicationAdmissionGate()

module.exports = {
    ApplicationAdmissionError,
    ApplicationAdmissionGate,
    applicationAdmissionGate
}
