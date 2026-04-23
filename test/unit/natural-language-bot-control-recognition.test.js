#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
    recognizeNaturalLanguageBotControlAction,
    recognizeBotControlShortcut
} = require('../../src/services/ai/naturalLanguageBotControlRecognitionService')

const {
    recognizeBotControlShortcut: recognizeBotControlShortcutFromHelper
} = require('../../src/services/ai/botControl/naturalLanguageShortcutParser')

const groupAtBotMeta = Object.freeze({
    source: 'group',
    isAtBot: true,
    isReplyToBot: false
})

function run() {
    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('查看AI配置', {
        messageMeta: groupAtBotMeta
    }), recognizeBotControlShortcut('查看AI配置', {
        messageMeta: groupAtBotMeta
    }))
    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('查看AI配置', {
        messageMeta: groupAtBotMeta
    }), recognizeBotControlShortcutFromHelper('查看AI配置', {
        messageMeta: groupAtBotMeta
    }))

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('reset current group context', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'context.write',
        input: {
            operation: 'reset'
        }
    })

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('清空上下文', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'context.write',
        input: {
            operation: 'reset'
        }
    })

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('重置当前群上下文', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'context.write',
        input: {
            operation: 'reset'
        }
    })

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('查看AI配置', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'config.read',
        input: {
            operation: 'get'
        }
    })

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('show ai status', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'config.read',
        input: {
            operation: 'get'
        }
    })

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('查看待审批', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'approval.read',
        input: {
            operation: 'list'
        }
    })

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('同意 REQ-ABC123', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'approval.write',
        input: {
            operation: 'approve',
            shortId: 'REQ-ABC123'
        }
    })

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('[CQ:reply,id=2001] 否', {
        messageMeta: {
            source: 'group',
            isAtBot: false,
            isReplyToBot: true,
            replyToMessageId: '2001'
        }
    }), {
        action: 'approval.write',
        input: {
            operation: 'reject',
            replyMessageId: '2001'
        }
    })

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('开启AI', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'config.write',
        input: {
            aiEnabled: true
        }
    })

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('disable rag', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'config.write',
        input: {
            aiRagEnabled: false
        }
    })

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('订阅 UID 12345', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'subscription.write',
        input: {
            operation: 'add_user',
            uid: '12345'
        }
    })

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('订阅uid 12345', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'subscription.write',
        input: {
            operation: 'add_user',
            uid: '12345'
        }
    })

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('取消订阅 UID 12345', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'subscription.write',
        input: {
            operation: 'remove_user',
            uid: '12345'
        }
    })

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('取消订阅uid 12345', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'subscription.write',
        input: {
            operation: 'remove_user',
            uid: '12345'
        }
    })

    assert.strictEqual(recognizeNaturalLanguageBotControlAction('今天吃什么', {
        messageMeta: groupAtBotMeta
    }), null)
    assert.strictEqual(recognizeNaturalLanguageBotControlAction('帮我看看AI状态怎么样', {
        messageMeta: groupAtBotMeta
    }), null)

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('订阅 小明', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'subscription.read',
        input: {
            operation: 'search_user',
            query: '小明'
        }
    })

    assert.deepStrictEqual(recognizeNaturalLanguageBotControlAction('订阅老番茄', {
        messageMeta: groupAtBotMeta
    }), {
        action: 'subscription.read',
        input: {
            operation: 'search_user',
            query: '老番茄'
        }
    })

    assert.strictEqual(recognizeNaturalLanguageBotControlAction('关闭AI', {
        messageMeta: {
            source: 'group',
            isAtBot: false,
            isReplyToBot: false
        }
    }), null)

    console.log('✓ naturalLanguageBotControlRecognitionService 作为兼容层保留窄范围 bot-control shortcut 识别')
}

try {
    run()
    process.exit(0)
} catch (error) {
    console.error(error)
    process.exit(1)
}
