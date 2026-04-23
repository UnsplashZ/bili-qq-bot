#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    resolveBotControlActionInput
} = require('../../src/services/ai/botControlActionResolutionService')

const groupAtBotMeta = Object.freeze({
    source: 'group',
    isAtBot: true,
    isReplyToBot: false
})

const groupReplyBotMeta = Object.freeze({
    source: 'group',
    isAtBot: false,
    isReplyToBot: true
})

function testExplicitCandidateWinsOverPendingFollowupAndNaturalLanguage() {
    const result = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '重置上下文',
            pipelineInput: {
                botControlAction: {
                    action: 'subscription.write',
                    input: {
                        operation: 'remove_user',
                        uid: '99'
                    }
                }
            }
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => ({
                    confirmationId: 'confirm-1',
                    action: 'subscription.write',
                    snapshot: {
                        action: 'subscription.write',
                        input: {
                            operation: 'add_user',
                            uid: '42'
                        }
                    }
                })
            }
        }
    })

    assert.strictEqual(result.source, 'explicit')
    assert.strictEqual(result.effectiveAgentInput.pipelineInput.botControlAction.input.uid, '99')
}

function testPendingFollowupOnlyActivatesWhenPendingConfirmationExists() {
    let receivedActorUserId = null
    const pendingResult = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '确认',
            userId: '2',
            messageMeta: groupReplyBotMeta
        },
        runtime: {
            botControl: {
                getPendingConfirmation: ({ actorUserId } = {}) => {
                    receivedActorUserId = actorUserId
                    return {
                        confirmationId: 'confirm-2',
                        action: 'subscription.write',
                        snapshot: {
                            action: 'subscription.write',
                            input: {
                                operation: 'add_user',
                                uid: '42'
                            }
                        }
                    }
                }
            }
        }
    })

    assert.strictEqual(receivedActorUserId, '2')
    assert.strictEqual(pendingResult.source, 'pending_followup')
    assert.deepStrictEqual(pendingResult.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'subscription.write',
        input: {
            operation: 'add_user',
            uid: '42',
            confirmationId: 'confirm-2'
        }
    })

    const noPendingResult = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '确认',
            messageMeta: groupReplyBotMeta
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null
            }
        }
    })

    assert.strictEqual(noPendingResult.source, 'absent')
    assert.strictEqual(noPendingResult.candidate, null)
}

function testPendingFollowupAcceptsExactReplyTargetWithoutIsReplyToBotMetadata() {
    const result = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '确认',
            userId: '2',
            messageMeta: {
                source: 'group',
                replyToMessageId: 'bot-confirm-1'
            }
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => ({
                    confirmationId: 'confirm-2b',
                    action: 'subscription.write',
                    botMessageId: 'bot-confirm-1',
                    snapshot: {
                        action: 'subscription.write',
                        input: {
                            operation: 'add_user',
                            uid: '42'
                        }
                    }
                }),
                getCandidateSelectionSnapshot: () => null
            }
        }
    })

    assert.strictEqual(result.source, 'pending_followup')
    assert.deepStrictEqual(result.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'subscription.write',
        input: {
            operation: 'add_user',
            uid: '42',
            confirmationId: 'confirm-2b'
        }
    })
}

function testPendingFollowupRejectsWrongActorEvenWithExactReplyTarget() {
    const result = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '确认',
            userId: '3',
            messageMeta: {
                source: 'group',
                replyToMessageId: 'bot-confirm-1'
            }
        },
        runtime: {
            botControl: {
                getPendingConfirmation: ({ actorUserId } = {}) => {
                    assert.strictEqual(actorUserId, '3')
                    return null
                },
                getCandidateSelectionSnapshot: () => null
            }
        }
    })

    assert.strictEqual(result.source, 'absent')
    assert.strictEqual(result.candidate, null)
}

function testPendingFollowupRejectsWrongReplyTargetWhenBoundBotMessageExists() {
    const result = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '确认',
            userId: '2',
            messageMeta: {
                source: 'group',
                isReplyToBot: true,
                replyToMessageId: 'bot-confirm-other'
            }
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => ({
                    confirmationId: 'confirm-2c',
                    action: 'subscription.write',
                    botMessageId: 'bot-confirm-1',
                    snapshot: {
                        action: 'subscription.write',
                        input: {
                            operation: 'add_user',
                            uid: '42'
                        }
                    }
                }),
                getCandidateSelectionSnapshot: () => null
            }
        }
    })

    assert.strictEqual(result.source, 'absent')
    assert.strictEqual(result.candidate, null)
}

function testNaturalLanguageCandidateWinsWhenPendingConfirmationDoesNotRecognizeFollowup() {
    const result = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '重置上下文',
            messageMeta: groupAtBotMeta
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => ({
                    confirmationId: 'confirm-3',
                    action: 'subscription.write',
                    snapshot: {
                        action: 'subscription.write',
                        input: {
                            operation: 'add_user',
                            uid: '42'
                        }
                    }
                })
            }
        }
    })

    assert.strictEqual(result.source, 'natural_language')
    assert.deepStrictEqual(result.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'context.write',
        input: {
            operation: 'reset'
        }
    })
}

function testNaturalLanguageConfigActionsUseStructuredConfigPath() {
    const configReadResult = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '查看AI配置',
            messageMeta: groupAtBotMeta
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null,
                getCandidateSelectionSnapshot: () => null
            }
        }
    })

    assert.strictEqual(configReadResult.source, 'natural_language')
    assert.deepStrictEqual(configReadResult.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'config.read',
        input: {
            operation: 'get'
        }
    })

    const configWriteResult = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '关闭RAG',
            messageMeta: groupAtBotMeta
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null,
                getCandidateSelectionSnapshot: () => null
            }
        }
    })

    assert.strictEqual(configWriteResult.source, 'natural_language')
    assert.deepStrictEqual(configWriteResult.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'config.write',
        input: {
            aiRagEnabled: false
        }
    })

    const approvalReadResult = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '查看待审批',
            messageMeta: groupAtBotMeta
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null,
                getCandidateSelectionSnapshot: () => null
            }
        }
    })

    assert.strictEqual(approvalReadResult.source, 'natural_language')
    assert.deepStrictEqual(approvalReadResult.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'approval.read',
        input: {
            operation: 'list'
        }
    })
}

function testNaturalLanguageApprovalWriteUsesExactReplyOrShortIdOnly() {
    const shortIdResult = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '同意 REQ-ABC123',
            messageMeta: groupAtBotMeta
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null,
                getCandidateSelectionSnapshot: () => null
            }
        }
    })

    assert.strictEqual(shortIdResult.source, 'natural_language')
    assert.deepStrictEqual(shortIdResult.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'approval.write',
        input: {
            operation: 'approve',
            shortId: 'REQ-ABC123'
        }
    })

    const replyResult = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '[CQ:reply,id=2001] 否',
            messageMeta: {
                ...groupReplyBotMeta,
                replyToMessageId: '2001'
            }
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null,
                getCandidateSelectionSnapshot: () => null
            }
        }
    })

    assert.strictEqual(replyResult.source, 'natural_language')
    assert.deepStrictEqual(replyResult.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'approval.write',
        input: {
            operation: 'reject',
            replyMessageId: '2001'
        }
    })

    const vagueResult = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '同意最新一个审批',
            messageMeta: groupAtBotMeta
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null,
                getCandidateSelectionSnapshot: () => null
            }
        }
    })

    assert.strictEqual(vagueResult.source, 'absent')
    assert.strictEqual(vagueResult.candidate, null)
}

function buildCandidateSelectionSnapshot(overrides = {}) {
    return {
        groupId: '1000',
        actorUserId: '2',
        botMessageId: 'bot-msg-1',
        query: '老番茄',
        candidates: [
            { rank: 1, uid: '546195', name: '老番茄' },
            { rank: 2, uid: '987654', name: '老番茄切片号' }
        ],
        createdAt: 1710000000000,
        expiresAt: 2710000000000,
        ...overrides
    }
}

function testNaturalLanguageFuzzySubscribeUsesSearchCandidate() {
    const result = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '订阅老番茄',
            messageMeta: groupAtBotMeta
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null
            }
        }
    })

    assert.strictEqual(result.source, 'natural_language')
    assert.deepStrictEqual(result.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'subscription.read',
        input: {
            operation: 'search_user',
            query: '老番茄'
        }
    })
}

function testCandidateSelectionFollowupRequiresSameActorExactBotReplyAndUnexpiredSnapshot() {
    const snapshot = buildCandidateSelectionSnapshot()

    const result = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '选2',
            userId: '2',
            messageMeta: {
                isReplyToBot: true,
                replyToMessageId: 'bot-msg-1'
            }
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null,
                getCandidateSelectionSnapshot: (options) => {
                    assert.deepStrictEqual(options, {
                        actorUserId: '2',
                        includeExpired: true
                    })
                    return snapshot
                }
            }
        }
    })

    assert.strictEqual(result.source, 'candidate_selection_followup')
    assert.deepStrictEqual(result.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'subscription.write',
        input: {
            operation: 'add_user',
            uid: '987654'
        }
    })
}

function testCandidateSelectionFollowupAcceptsExactReplyTargetWithoutIsReplyToBotMetadata() {
    const result = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '1',
            userId: '2',
            messageMeta: {
                replyToMessageId: 'bot-msg-1'
            }
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null,
                getCandidateSelectionSnapshot: () => buildCandidateSelectionSnapshot()
            }
        }
    })

    assert.strictEqual(result.source, 'candidate_selection_followup')
    assert.deepStrictEqual(result.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'subscription.write',
        input: {
            operation: 'add_user',
            uid: '546195'
        }
    })
}

function testCandidateSelectionFollowupRejectsWrongActor() {
    const result = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '1',
            userId: '3',
            messageMeta: {
                isReplyToBot: true,
                replyToMessageId: 'bot-msg-1'
            }
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null,
                getCandidateSelectionSnapshot: () => buildCandidateSelectionSnapshot({ actorUserId: '2' })
            }
        }
    })

    assert.strictEqual(result.source, 'absent')
    assert.strictEqual(result.candidate, null)
}

function testCandidateSelectionFollowupRejectsWrongReplyTarget() {
    const result = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '1',
            userId: '2',
            messageMeta: {
                isReplyToBot: true,
                replyToMessageId: 'bot-msg-other'
            }
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null,
                getCandidateSelectionSnapshot: () => buildCandidateSelectionSnapshot()
            }
        }
    })

    assert.strictEqual(result.source, 'absent')
    assert.strictEqual(result.candidate, null)
}

function testCandidateSelectionFollowupReturnsExpiredInvalidActionAndClearsSnapshot() {
    let clearCalls = 0
    const result = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '1',
            userId: '2',
            messageMeta: {
                isReplyToBot: true,
                replyToMessageId: 'bot-msg-1'
            }
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null,
                getCandidateSelectionSnapshot: () => buildCandidateSelectionSnapshot({
                    expiresAt: 1709999999999
                }),
                clearCandidateSelectionSnapshot: (options) => {
                    clearCalls += 1
                    assert.deepStrictEqual(options, { actorUserId: '2' })
                }
            }
        }
    })

    assert.strictEqual(clearCalls, 1)
    assert.strictEqual(result.source, 'candidate_selection_followup')
    assert.deepStrictEqual(result.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'candidate_selection.invalid',
        input: {
            error: '候选已过期，请重新搜索。'
        }
    })
}

function testPendingConfirmationFollowupBeatsCandidateSelectionFollowup() {
    const result = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '确认',
            userId: '2',
            messageMeta: {
                isReplyToBot: true,
                replyToMessageId: 'bot-msg-1'
            }
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => ({
                    confirmationId: 'confirm-4',
                    action: 'subscription.write',
                    snapshot: {
                        action: 'subscription.write',
                        input: {
                            operation: 'add_user',
                            uid: '42'
                        }
                    }
                }),
                getCandidateSelectionSnapshot: () => buildCandidateSelectionSnapshot({
                    candidates: [
                        { rank: 1, uid: '546195', name: '老番茄' }
                    ]
                })
            }
        }
    })

    assert.strictEqual(result.source, 'pending_followup')
    assert.deepStrictEqual(result.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'subscription.write',
        input: {
            operation: 'add_user',
            uid: '42',
            confirmationId: 'confirm-4'
        }
    })
}

function testInvalidCandidateSelectionFollowupReturnsDeterministicInvalidAction() {
    const snapshot = buildCandidateSelectionSnapshot()

    const invalidIndexResult = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '第9个',
            userId: '2',
            messageMeta: {
                isReplyToBot: true,
                replyToMessageId: 'bot-msg-1'
            }
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null,
                getCandidateSelectionSnapshot: () => snapshot
            }
        }
    })

    assert.strictEqual(invalidIndexResult.source, 'candidate_selection_followup')
    assert.deepStrictEqual(invalidIndexResult.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'candidate_selection.invalid',
        input: {
            error: '当前候选列表中没有这个序号或 UID，请回复 1-2 之间的序号，或候选 UID。'
        }
    })

    const invalidUidResult = resolveBotControlActionInput({
        agentInput: {
            rawMessage: '123456789',
            userId: '2',
            messageMeta: {
                isReplyToBot: true,
                replyToMessageId: 'bot-msg-1'
            }
        },
        runtime: {
            botControl: {
                getPendingConfirmation: () => null,
                getCandidateSelectionSnapshot: () => snapshot
            }
        }
    })

    assert.strictEqual(invalidUidResult.source, 'candidate_selection_followup')
    assert.deepStrictEqual(invalidUidResult.effectiveAgentInput.pipelineInput.botControlAction, {
        action: 'candidate_selection.invalid',
        input: {
            error: '当前候选列表中没有这个序号或 UID，请回复 1-2 之间的序号，或候选 UID。'
        }
    })
}

function run() {
    testExplicitCandidateWinsOverPendingFollowupAndNaturalLanguage()
    testPendingFollowupOnlyActivatesWhenPendingConfirmationExists()
    testPendingFollowupAcceptsExactReplyTargetWithoutIsReplyToBotMetadata()
    testPendingFollowupRejectsWrongActorEvenWithExactReplyTarget()
    testPendingFollowupRejectsWrongReplyTargetWhenBoundBotMessageExists()
    testNaturalLanguageCandidateWinsWhenPendingConfirmationDoesNotRecognizeFollowup()
    testNaturalLanguageConfigActionsUseStructuredConfigPath()
    testNaturalLanguageApprovalWriteUsesExactReplyOrShortIdOnly()
    testNaturalLanguageFuzzySubscribeUsesSearchCandidate()
    testCandidateSelectionFollowupRequiresSameActorExactBotReplyAndUnexpiredSnapshot()
    testCandidateSelectionFollowupAcceptsExactReplyTargetWithoutIsReplyToBotMetadata()
    testCandidateSelectionFollowupRejectsWrongActor()
    testCandidateSelectionFollowupRejectsWrongReplyTarget()
    testCandidateSelectionFollowupReturnsExpiredInvalidActionAndClearsSnapshot()
    testPendingConfirmationFollowupBeatsCandidateSelectionFollowup()
    testInvalidCandidateSelectionFollowupReturnsDeterministicInvalidAction()
    console.log('✓ botControlActionResolutionService preserves explicit > pending follow-up > candidate-selection follow-up > natural-language > absent precedence')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
