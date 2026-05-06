const assert = require('assert')
const config = require('../../../src/config')

// 直接测试 src/config.js 导出的真实 helper 函数
const {
    isVideoDownloadEnabledForGroup,
    getVideoDownloadResolutionForGroup,
    getVideoDownloadMaxDurationForGroup,
} = config

// 备份原始配置状态
const originalEnabled = config.videoDownloadEnabled
const originalResolution = config.videoDownloadResolution
const originalMaxDuration = config.videoDownloadMaxDuration
const originalGroupConfigs = { ...config.groupConfigs }

function resetGroupConfig(groupId) {
    if (originalGroupConfigs[groupId] !== undefined) {
        config.groupConfigs[groupId] = { ...originalGroupConfigs[groupId] }
    } else {
        delete config.groupConfigs[groupId]
    }
}

// --- isVideoDownloadEnabledForGroup ---

// 全局关闭，无群级配置 → false
config.videoDownloadEnabled = false
delete config.groupConfigs['123']
assert.strictEqual(isVideoDownloadEnabledForGroup('123'), false, 'global off, no group override → false')

// 全局关闭，群级显式开启 → true（群可独立覆盖）
config.videoDownloadEnabled = false
config.groupConfigs['123'] = { videoDownloadEnabled: true }
assert.strictEqual(isVideoDownloadEnabledForGroup('123'), true, 'global off, group override on → true')

// 全局开启，无群级配置 → true
config.videoDownloadEnabled = true
delete config.groupConfigs['123']
assert.strictEqual(isVideoDownloadEnabledForGroup('123'), true, 'global on, no group override → true')

// 全局开启，群级关闭 → false
config.videoDownloadEnabled = true
config.groupConfigs['123'] = { videoDownloadEnabled: false }
assert.strictEqual(isVideoDownloadEnabledForGroup('123'), false, 'global on, group override off → false')

// 全局开启，群级开启 → true
config.videoDownloadEnabled = true
config.groupConfigs['123'] = { videoDownloadEnabled: true }
assert.strictEqual(isVideoDownloadEnabledForGroup('123'), true, 'global on, group override on → true')

// --- getVideoDownloadResolutionForGroup ---

config.videoDownloadResolution = '1080p'
delete config.groupConfigs['999']
assert.strictEqual(getVideoDownloadResolutionForGroup('999'), '1080p', 'no group config → global default')

config.groupConfigs['999'] = { videoDownloadResolution: '720p' }
assert.strictEqual(getVideoDownloadResolutionForGroup('999'), '720p', 'group override resolution')

// --- getVideoDownloadMaxDurationForGroup ---

config.videoDownloadMaxDuration = 600
delete config.groupConfigs['888']
assert.strictEqual(getVideoDownloadMaxDurationForGroup('888'), 600, 'no group config → global default')

config.groupConfigs['888'] = { videoDownloadMaxDuration: 0 }
assert.strictEqual(getVideoDownloadMaxDurationForGroup('888'), 0, '0 means no limit')

config.groupConfigs['888'] = { videoDownloadMaxDuration: 300 }
assert.strictEqual(getVideoDownloadMaxDurationForGroup('888'), 300, 'group override max duration')

// 恢复配置
config.videoDownloadEnabled = originalEnabled
config.videoDownloadResolution = originalResolution
config.videoDownloadMaxDuration = originalMaxDuration
delete config.groupConfigs['123']
delete config.groupConfigs['999']
delete config.groupConfigs['888']

console.log('✅ All videoDownloadConfig tests passed')
