#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    detectIdentityIntent,
    getSpeakerId,
    getSpeakerName,
    getMentionIds,
    buildSpeakerTag,
    buildTurnFacts,
    buildAdminNoToolReply,
    applyAdminActionGuard
} = require('../../src/services/ai/identityPolicyService')

function testIntentDetection() {
    assert.strictEqual(detectIdentityIntent('我是reborn'), 'self_identity')
    assert.strictEqual(detectIdentityIntent('我是来测试的'), 'general')
    assert.strictEqual(detectIdentityIntent('你是谁'), 'bot_identity')
    assert.strictEqual(detectIdentityIntent('按照群规需要踢出用户2402855757'), 'admin_action')
    console.log('✓ detectIdentityIntent 分类符合预期')
}

function testSpeakerHelpers() {
    const msg = {
        speakerId: '2402855757',
        speakerName: 'Re[b]orn<test>\n',
        mentionIds: ['1099804769', 'bad_id', '1099804769']
    }
    assert.strictEqual(getSpeakerId(msg), '2402855757')
    assert.strictEqual(getSpeakerName(msg, '用户'), 'Re[b]orn<test>\n')
    assert.deepStrictEqual(getMentionIds(msg), ['1099804769'])
    assert.strictEqual(
        buildSpeakerTag(msg, null, '用户'),
        '[speaker_id=2402855757][speaker_name=Re b orntest][mentions=1099804769]'
    )
    console.log('✓ speaker helpers 会做安全归一化')
}

function testTurnFactsAndGuard() {
    const facts = buildTurnFacts({
        currentMsg: {
            speakerId: '2402855757',
            speakerName: 'Re[b]orn<test>\n',
            mentionIds: ['1099804769', 'bad_id', '1099804769'],
            isAtBot: true,
            source: 'group'
        },
        userId: '2402855757',
        groupId: '1065812436',
        intentType: 'self_identity',
        botId: '1099804769',
        ownerId: '793122294'
    })
    assert.ok(facts.includes('owner_id=793122294'))
    assert.ok(facts.includes('current_speaker_id=2402855757'))
    assert.ok(facts.includes('current_mention_ids=[1099804769]'))
    assert.ok(facts.includes('current_is_owner=false'))
    assert.ok(facts.includes('current_is_at_bot=true'))
    assert.ok(facts.includes('current_speaker_name=Re b orntest'))
    assert.strictEqual(
        applyAdminActionGuard('已经处理', 'admin_action', false, true),
        buildAdminNoToolReply()
    )
    console.log('✓ TURN_FACTS 与 admin guard 符合预期')
}

try {
    testIntentDetection()
    testSpeakerHelpers()
    testTurnFactsAndGuard()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
