const assert = require('assert')
const config = require('../../src/config')

const { isAiEnabledForGroup, isRagEnabledForGroup } = config

const originalAiEnabled = config.aiEnabled
const originalAiRagEnabled = config.aiRagEnabled
const originalGroupConfigs = { ...config.groupConfigs }

function restoreGroup(groupId) {
    if (Object.prototype.hasOwnProperty.call(originalGroupConfigs, groupId)) {
        config.groupConfigs[groupId] = { ...originalGroupConfigs[groupId] }
    } else {
        delete config.groupConfigs[groupId]
    }
}

const gid = 'ai_test_group'

// 全局开启 + 群配置 null => 继承全局，应为 true
config.aiEnabled = true
config.aiRagEnabled = true
config.groupConfigs[gid] = { aiEnabled: null, aiRagEnabled: null }
assert.strictEqual(isAiEnabledForGroup(gid), true, 'aiEnabled=null 时应继承全局 true')
assert.strictEqual(isRagEnabledForGroup(gid), true, 'aiRagEnabled=null 时应继承全局 true')

// 群级显式关闭 AI => AI/RAG 都应关闭
config.groupConfigs[gid] = { aiEnabled: false, aiRagEnabled: true }
assert.strictEqual(isAiEnabledForGroup(gid), false, '群级 aiEnabled=false 应关闭 AI')
assert.strictEqual(isRagEnabledForGroup(gid), false, 'AI 关闭时 RAG 必须关闭')

// 群级显式关闭 RAG => 仅 RAG 关闭
config.groupConfigs[gid] = { aiEnabled: true, aiRagEnabled: false }
assert.strictEqual(isAiEnabledForGroup(gid), true, '群级 aiEnabled=true 应开启 AI')
assert.strictEqual(isRagEnabledForGroup(gid), false, '群级 aiRagEnabled=false 应关闭 RAG')

// 全局 AI 关闭优先级最高
config.aiEnabled = false
config.groupConfigs[gid] = { aiEnabled: true, aiRagEnabled: true }
assert.strictEqual(isAiEnabledForGroup(gid), false, '全局 AI 关闭时，群级不能强制开启')
assert.strictEqual(isRagEnabledForGroup(gid), false, '全局 AI 关闭时 RAG 必须关闭')

// 恢复现场
config.aiEnabled = originalAiEnabled
config.aiRagEnabled = originalAiRagEnabled
restoreGroup(gid)

console.log('✅ AI group switch inheritance tests passed')
