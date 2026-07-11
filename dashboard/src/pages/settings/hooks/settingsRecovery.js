import { fetchConsistentSettingsSnapshot } from './settingsSnapshot.js'

export function toPublicRecoveryFailure(error) {
    const payload = error?.response?.data || {}
    return {
        code: typeof payload.code === 'string' ? payload.code : 'CONFIG_RECOVERY_FAILED',
        phase: typeof payload.phase === 'string' ? payload.phase : 'recovery-required'
    }
}

export function isRecoveryRequiredResponse(error) {
    return error?.response?.data?.recoveryRequired?.required === true
}

export function createSettingsRecoveryCoordinator({ recover, fetchConfig, fetchStatus }) {
    let activePromise = null

    return {
        run() {
            if (activePromise) return activePromise
            activePromise = (async () => {
                const recoveryResult = await recover()
                const consistent = await fetchConsistentSettingsSnapshot(fetchConfig, fetchStatus)
                return { recoveryResult, ...consistent }
            })()
            activePromise.then(
                () => { activePromise = null },
                () => { activePromise = null }
            )
            return activePromise
        },
        isRunning() {
            return activePromise !== null
        }
    }
}
