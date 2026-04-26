#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const longTermStore = require(path.join(__dirname, '../../src/agent/memory/longTermStore'))
const { maybeStoreTopicSummary } = require(path.join(__dirname, '../../src/agent/memory/topicSummaryRecorder'))

const tempMemoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-qq-agent-long-memory-'))
const tempMemoryFile = path.join(tempMemoryDir, 'memories.json')

async function run() {
    longTermStore.resetForTest(tempMemoryFile)

    try {
        await longTermStore.storeMemoryHints({
            hints: [{
                scope: 'user',
                type: 'preference',
                content: '用户喜欢少前2',
                confidence: 0.8
            }],
            sessionContext: {
                groupId: '1000',
                userId: '42',
                topicId: 'topic-user',
                traceScope: 'test:long-memory'
            },
            agentMessage: { id: 'msg-user-memory' },
            decision: { action: 'observe_only' }
        })

        const matched = await longTermStore.retrieveRelevantMemories({
            groupId: '1000',
            userId: '42',
            text: '少前2剧情怎么样'
        })
        assert.strictEqual(matched.length, 1)
        assert.ok(matched[0].content.includes('少前2'))

        const otherUserMatched = await longTermStore.retrieveRelevantMemories({
            groupId: '1000',
            userId: '43',
            text: '少前2剧情怎么样'
        })
        assert.strictEqual(otherUserMatched.length, 0)

        const topic = {
            topicId: 'topic-game',
            keywords: ['少前2', '剧情', '活动'],
            participants: new Set(['42', '43']),
            recentMessageIds: ['topic-msg-1', 'topic-msg-2', 'topic-msg-3'],
            summary: '少前2活动剧情讨论',
            createdAt: 1000,
            lastActiveAt: 2000,
            messageCount: 6
        }
        const topicSnapshot = {
            ...topic,
            participants: ['42', '43']
        }
        const agentConfig = {
            longTerm: {
                topicSummaryEnabled: true,
                topicSummaryMinMessages: 3,
                topicSummaryMinIntervalMs: 60 * 1000
            }
        }
        const sessionContext = {
            groupId: '1000',
            userId: '42',
            topicId: topic.topicId,
            traceScope: 'test:topic-summary'
        }

        const firstSummary = await maybeStoreTopicSummary({
            agentConfig,
            memoryObservation: { topic, topicSnapshot },
            sessionContext,
            agentMessage: { id: 'topic-msg-3', timestamp: 10 * 60 * 1000 }
        })
        assert.strictEqual(firstSummary.stored, 1)

        const skippedSummary = await maybeStoreTopicSummary({
            agentConfig,
            memoryObservation: { topic, topicSnapshot },
            sessionContext,
            agentMessage: { id: 'topic-msg-4', timestamp: 10 * 60 * 1000 + 1000 }
        })
        assert.strictEqual(skippedSummary.stored, 0)
        assert.strictEqual(skippedSummary.reason, 'summary_interval_active')

        topic.lastSummarizedAt = 0
        topic.messageCount = 8
        topicSnapshot.messageCount = 8
        topicSnapshot.recentMessageIds = ['topic-msg-1', 'topic-msg-2', 'topic-msg-3', 'topic-msg-4']
        const updatedSummary = await maybeStoreTopicSummary({
            agentConfig,
            memoryObservation: { topic, topicSnapshot },
            sessionContext,
            agentMessage: { id: 'topic-msg-4', timestamp: 20 * 60 * 1000 }
        })
        assert.strictEqual(updatedSummary.stored, 1)
        assert.strictEqual(updatedSummary.id, firstSummary.id)

        const memories = await longTermStore.listMemories({ groupId: '1000', limit: 10 })
        const topicMemories = memories.filter((memory) => memory.scope === 'topic')
        assert.strictEqual(topicMemories.length, 1)
        assert.ok(topicMemories[0].content.includes('少前2活动剧情讨论'))
        assert.ok(topicMemories[0].sourceMessageIds.includes('topic-msg-4'))
        assert.ok(topicMemories[0].expiresAt)

        const sameTopicSummary = await longTermStore.retrieveRelevantMemories({
            groupId: '1000',
            userId: '42',
            topicId: 'topic-game',
            text: '刚才活动剧情聊到哪了'
        })
        assert.ok(sameTopicSummary.some((memory) => memory.scope === 'topic'))

        const unrelatedTopicSummary = await longTermStore.retrieveRelevantMemories({
            groupId: '1000',
            userId: '42',
            topicId: 'topic-food',
            text: '今晚吃什么'
        })
        assert.ok(!unrelatedTopicSummary.some((memory) => memory.scope === 'topic'), '无关话题不应注入旧 topic summary')

        longTermStore.resetForTest(tempMemoryFile)
        await longTermStore.storeMemoryHints({
            hints: [{
                scope: 'group',
                type: 'relation',
                content: 'uid 2402855757 是 楠哥',
                confidence: 0.8
            }],
            sessionContext: {
                groupId: '1000',
                userId: '42',
                topicId: 'topic-relation',
                traceScope: 'test:relation-conflict'
            },
            agentMessage: { id: 'relation-msg-1' },
            decision: { action: 'short_reply' }
        })
        const conflictWrite = await longTermStore.storeMemoryHints({
            hints: [{
                scope: 'group',
                type: 'relation',
                content: 'uid 2402855757 是 梦桦楠',
                confidence: 0.85
            }],
            sessionContext: {
                groupId: '1000',
                userId: '42',
                topicId: 'topic-relation',
                traceScope: 'test:relation-conflict'
            },
            agentMessage: { id: 'relation-msg-2' },
            decision: { action: 'short_reply' }
        })
        assert.strictEqual(conflictWrite.stored, 1)
        const relationMemories = await longTermStore.listMemories({ groupId: '1000' })
        const uidMemories = relationMemories.filter((memory) => memory.content.includes('uid 2402855757'))
        assert.strictEqual(uidMemories.length, 1)
        assert.strictEqual(uidMemories[0].content, 'uid 2402855757 是 梦桦楠')
        assert.strictEqual(uidMemories[0].supersedes.length, 1)

        const relationRead = await longTermStore.retrieveRelevantMemories({
            groupId: '1000',
            userId: '42',
            text: '梦桦楠是谁'
        })
        assert.ok(relationRead.length > 0)
        assert.ok(relationRead[0].accessCount > 0)
        assert.ok(relationRead[0].lastAccessedAt)

        console.log('✓ Agent 长期记忆检索和话题摘要固化正常')
    } finally {
        longTermStore.resetForTest()
        fs.rmSync(tempMemoryDir, { recursive: true, force: true })
    }
}

run()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
