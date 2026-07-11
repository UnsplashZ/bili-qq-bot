'use strict'

class ReleaseEpochGate {
    constructor() {
        this.epoch = null
        this.armed = false
        this.released = false
        this.admissionEnabled = false
    }

    arm(epoch) {
        const value = String(epoch || '').trim()
        if (!value) throw new TypeError('releaseEpoch is required')
        if (this.epoch && this.epoch !== value) throw new Error('another releaseEpoch is already armed')
        this.epoch = value
        this.armed = true
        return this.snapshot()
    }

    release(epoch) {
        if (!this.armed || String(epoch) !== this.epoch) throw new Error('releaseEpoch mismatch')
        this.released = true
        return this.snapshot()
    }

    enableAdmission(epoch) {
        if (!this.released || String(epoch) !== this.epoch) throw new Error('releaseEpoch is not released')
        this.admissionEnabled = true
        return this.snapshot()
    }

    reset(epoch) {
        if (epoch !== undefined && String(epoch) !== this.epoch) return false
        this.epoch = null
        this.armed = false
        this.released = false
        this.admissionEnabled = false
        return true
    }

    assertAdmission() {
        if (!this.admissionEnabled) {
            const error = new Error('runtime admission is disabled')
            error.code = 'RUNTIME_ADMISSION_DISABLED'
            throw error
        }
    }

    restore(snapshot = {}) {
        this.epoch = snapshot.epoch ? String(snapshot.epoch) : null
        this.armed = Boolean(snapshot.armed)
        this.released = Boolean(snapshot.released)
        this.admissionEnabled = Boolean(snapshot.admissionEnabled)
    }

    snapshot() {
        return {
            epoch: this.epoch,
            armed: this.armed,
            released: this.released,
            admissionEnabled: this.admissionEnabled
        }
    }
}

module.exports = {
    ReleaseEpochGate
}
