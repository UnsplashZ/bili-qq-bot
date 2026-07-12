import assert from 'node:assert/strict'
import {
    createHydratedSettingsState,
    fetchConsistentSettingsSnapshot
} from '../../../dashboard/src/pages/settings/hooks/settingsSnapshot.js'

describe('Dashboard settings snapshot hydration', () => {
    it('rejects status fields from a different generation', () => {
        const staleStatus = {
            documentGeneration: 9,
            generation: 9,
            pendingDeploymentApply: ['deployment.ports.dashboardHost']
        }
        const configResponse = {
            generation: 8,
            subscriptionCheckInterval: 321,
            qqProvider: 'official',
            qqOfficialAppId: 'snapshot-8-app'
        }
        assert.throws(
            () => createHydratedSettingsState(configResponse, staleStatus),
            /snapshot generation 8 does not match status generation 9/
        )
    })

    it('hydrates form values and expected generation from a matching snapshot', () => {
        const configResponse = {
            generation: 8,
            subscriptionCheckInterval: 321,
            qqProvider: 'official',
            qqOfficialAppId: 'snapshot-8-app'
        }
        const hydrated = createHydratedSettingsState(configResponse, {
            documentGeneration: 8,
            generation: 8,
            effectiveGeneration: 7,
            pendingDeploymentApply: ['deployment.ports.dashboardHost']
        })
        assert.equal(hydrated.generalConfig.subscriptionCheckInterval, 321)
        assert.equal(hydrated.qqProviderConfig.qqOfficialAppId, 'snapshot-8-app')
        assert.equal(hydrated.configStatus.documentGeneration, 8)
        assert.equal(hydrated.configStatus.generation, 8)
        assert.deepEqual(hydrated.configStatus.pendingDeploymentApply, ['deployment.ports.dashboardHost'])
    })

    it('retries interleaved reads until config and status generations match', async () => {
        const configs = [
            { generation: 8, subscriptionCheckInterval: 321 },
            { generation: 9, subscriptionCheckInterval: 654 }
        ]
        const statuses = [
            { documentGeneration: 9, effectiveGeneration: 8 },
            { documentGeneration: 9, effectiveGeneration: 9 }
        ]
        let configReads = 0
        let statusReads = 0

        const consistent = await fetchConsistentSettingsSnapshot(
            async () => configs[configReads++],
            async () => statuses[statusReads++]
        )

        assert.equal(configReads, 2)
        assert.equal(statusReads, 2)
        assert.equal(consistent.snapshot.generation, 9)
        assert.equal(consistent.status.documentGeneration, 9)
        const hydrated = createHydratedSettingsState(consistent.snapshot, consistent.status)
        assert.equal(hydrated.generalConfig.subscriptionCheckInterval, 654)
        assert.equal(hydrated.configStatus.effectiveGeneration, 9)
    })

    it('fails after a bounded number of inconsistent reads', async () => {
        let configReads = 0
        let statusReads = 0

        await assert.rejects(
            fetchConsistentSettingsSnapshot(
                async () => ({ generation: ++configReads }),
                async () => ({ documentGeneration: 100 + ++statusReads }),
                { maxAttempts: 2 }
            ),
            /after 2 attempts/
        )
        assert.equal(configReads, 2)
        assert.equal(statusReads, 2)
    })
})
