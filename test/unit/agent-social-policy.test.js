#!/usr/bin/env node
'use strict'

const assert = require('assert')
const path = require('path')

const { scoreSocialInterject, isRapidTwoPersonChat } = require(path.join(__dirname, '../../src/agent/social/socialInterjectScorer'))
const { normalizeSocialConfig, checkSocialBudget, recordSocialSend, resetSocialBudget } = require(path.join(__dirname, '../../src/agent/social/socialBudget'))

function run() {
    resetSocialBudget()
    const agentConfig = {
        social: {
            enabled: true,
            mode: 'debug',
            minInterjectScore: 0.5,
            cooldownMs: 90000,
            dailyInterjectLimit: 2,
            perTopicInterjectLimit: 1
        }
    }

    const socialScore = scoreSocialInterject({
        agentConfig,
        agentMessage: { normalizedText: '这个新番节奏慢但是作画很稳', timestamp: 3000 },
        memoryObservation: { groupState: { recentMessages: [] } },
        scoreResult: { traits: {} }
    })
    assert.ok(socialScore.score >= 0.5)

    const budgetAllowed = checkSocialBudget({
        agentConfig,
        groupId: '1000',
        userId: '42',
        topicId: 'topic_a',
        timestamp: 100000,
        action: 'casual_interject',
        score: 0.8
    })
    assert.strictEqual(budgetAllowed.allowed, true)

    const zeroConfig = normalizeSocialConfig({
        social: {
            enabled: true,
            mode: 'normal',
            cooldownMs: 0,
            dailyInterjectLimit: 0,
            perTopicInterjectLimit: 0,
            interjectProbability: 0,
            ambientReactProbability: 0,
            minInterjectScore: 0,
            minAmbientScore: 0,
            maxCasualReplyChars: 20
        }
    })
    assert.strictEqual(zeroConfig.cooldownMs, 0)
    assert.strictEqual(zeroConfig.dailyInterjectLimit, 0)
    assert.strictEqual(zeroConfig.interjectProbability, 0)

    const zeroProbabilitySkipped = checkSocialBudget({
        agentConfig: {
            social: {
                enabled: true,
                mode: 'normal',
                interjectProbability: 0,
                minInterjectScore: 0,
                cooldownMs: 0,
                dailyInterjectLimit: 0,
                perTopicInterjectLimit: 0
            }
        },
        groupId: '1001',
        userId: '42',
        topicId: 'topic_zero',
        timestamp: 100000,
        action: 'casual_interject',
        score: 1
    })
    assert.strictEqual(zeroProbabilitySkipped.allowed, false)
    assert.strictEqual(zeroProbabilitySkipped.reason, 'social_probability_skip')

    const rapidBlocked = checkSocialBudget({
        agentConfig,
        groupId: '1000',
        userId: '42',
        topicId: 'topic_rapid',
        timestamp: 100000,
        action: 'casual_interject',
        score: 0.9,
        socialScore: { rapidTwoPersonChat: true }
    })
    assert.strictEqual(rapidBlocked.allowed, false)
    assert.strictEqual(rapidBlocked.reason, 'social_rapid_two_person_chat')

    recordSocialSend({ groupId: '1000', topicId: 'topic_a', timestamp: 100000 })

    const topicLimited = checkSocialBudget({
        agentConfig,
        groupId: '1000',
        userId: '42',
        topicId: 'topic_a',
        timestamp: 200000,
        action: 'casual_interject',
        score: 0.8
    })
    assert.strictEqual(topicLimited.allowed, false)
    assert.strictEqual(topicLimited.reason, 'social_topic_limit')

    assert.strictEqual(isRapidTwoPersonChat({
        groupState: {
            recentMessages: [
                { userId: '1', timestamp: 1000 },
                { userId: '2', timestamp: 2000 },
                { userId: '1', timestamp: 3000 },
                { userId: '2', timestamp: 4000 }
            ]
        }
    }, { userId: '2', timestamp: 5000 }), true)

    console.log('✓ Agent social interject policy 正常')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
