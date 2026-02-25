const assert = require('assert')

// Mock config state for testing helper logic in isolation
const configMock = {
    videoDownloadEnabled: true,
    videoDownloadResolution: '1080p',
    videoDownloadMaxDuration: 600,
    groupConfigs: {}
}

function isVideoDownloadEnabledForGroup(groupId) {
    if (!configMock.videoDownloadEnabled) return false
    const groupConfig = configMock.groupConfigs[String(groupId)]
    if (groupConfig && 'videoDownloadEnabled' in groupConfig) {
        return groupConfig.videoDownloadEnabled
    }
    return true
}
function getVideoDownloadResolutionForGroup(groupId) {
    const groupConfig = configMock.groupConfigs[String(groupId)]
    if (groupConfig && groupConfig.videoDownloadResolution) {
        return groupConfig.videoDownloadResolution
    }
    return configMock.videoDownloadResolution
}
function getVideoDownloadMaxDurationForGroup(groupId) {
    const groupConfig = configMock.groupConfigs[String(groupId)]
    if (groupConfig && 'videoDownloadMaxDuration' in groupConfig) {
        return groupConfig.videoDownloadMaxDuration
    }
    return configMock.videoDownloadMaxDuration
}

// Tests
configMock.videoDownloadEnabled = false
assert.strictEqual(isVideoDownloadEnabledForGroup('123'), false, 'global off → false')

configMock.videoDownloadEnabled = true
assert.strictEqual(isVideoDownloadEnabledForGroup('123'), true, 'global on, no group override → true')

configMock.groupConfigs['123'] = { videoDownloadEnabled: false }
assert.strictEqual(isVideoDownloadEnabledForGroup('123'), false, 'group override off → false')

configMock.groupConfigs['123'] = { videoDownloadEnabled: true }
assert.strictEqual(isVideoDownloadEnabledForGroup('123'), true, 'group override on → true')

assert.strictEqual(getVideoDownloadResolutionForGroup('999'), '1080p', 'no group config → global default')
configMock.groupConfigs['999'] = { videoDownloadResolution: '720p' }
assert.strictEqual(getVideoDownloadResolutionForGroup('999'), '720p', 'group override resolution')

assert.strictEqual(getVideoDownloadMaxDurationForGroup('888'), 600, 'no group config → global default')
configMock.groupConfigs['888'] = { videoDownloadMaxDuration: 0 }
assert.strictEqual(getVideoDownloadMaxDurationForGroup('888'), 0, '0 means no limit')

console.log('✅ All videoDownloadConfig tests passed')
