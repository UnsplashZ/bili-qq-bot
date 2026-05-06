const notificationService = require('./notificationService')

const ONLINE_STATUS_PRESETS = {
    online: { status: 10, extStatus: 0, batteryStatus: 0, label: '在线' },
    qme: { status: 60, extStatus: 0, batteryStatus: 0, label: 'Q我吧' },
    away: { status: 30, extStatus: 0, batteryStatus: 0, label: '离开' },
    busy: { status: 50, extStatus: 0, batteryStatus: 0, label: '忙碌' },
    invisible: { status: 40, extStatus: 0, batteryStatus: 0, label: '隐身' },
    dnd: { status: 70, extStatus: 0, batteryStatus: 0, label: '请勿打扰' },
    studying: { status: 10, extStatus: 1018, batteryStatus: 0, label: '学习中' },
    sleeping: { status: 10, extStatus: 1016, batteryStatus: 0, label: '睡觉中' },
    gaming: { status: 10, extStatus: 1027, batteryStatus: 0, label: 'Timi中' },
    fishing: { status: 10, extStatus: 1300, batteryStatus: 0, label: '摸鱼中' }
}

const INPUT_STATUS_PRESETS = {
    speaking: { eventType: 0, label: '正在说话' },
    typing: { eventType: 1, label: '正在输入' }
}

function ensureActionOk(response, action) {
    const retcode = response?.retcode
    if (response?.status === 'ok' && (retcode === 0 || retcode === undefined || retcode === null)) {
        return response
    }
    throw new Error(response?.wording || response?.message || `${action}_failed`)
}

function getWs(options = {}) {
    return options.ws || global.bot?.ws || null
}

class QqAccountService {
    async callAction(action, params, options = {}) {
        const response = await notificationService.callAction(getWs(options), action, params, 'QqAccount', options.timeoutMs || 10000)
        return ensureActionOk(response, action)
    }

    async setOnlineStatus({ status, extStatus = 0, batteryStatus = 0, preset = '' }, options = {}) {
        const presetConfig = ONLINE_STATUS_PRESETS[String(preset || '').trim().toLowerCase()]
        const payload = presetConfig
            ? {
                status: presetConfig.status,
                extStatus: presetConfig.extStatus,
                batteryStatus: presetConfig.batteryStatus
            }
            : {
                status: Math.trunc(Number(status)),
                extStatus: Math.trunc(Number(extStatus) || 0),
                batteryStatus: Math.trunc(Number(batteryStatus) || 0)
            }
        if (!Number.isFinite(payload.status)) throw new Error('invalid_online_status')
        await this.callAction('set_online_status', payload, options)
        return {
            message: `已设置 QQ 在线状态为 ${presetConfig?.label || payload.status}。`,
            data: { ...payload, preset: preset || '' }
        }
    }

    async setInputStatus({ userId, eventType, preset = '' }, options = {}) {
        const safeUserId = String(userId || '').trim()
        if (!/^\d+$/.test(safeUserId)) throw new Error('invalid_target_user_id')
        const presetConfig = INPUT_STATUS_PRESETS[String(preset || '').trim().toLowerCase()]
        const safeEventType = presetConfig ? presetConfig.eventType : Math.trunc(Number(eventType))
        if (![0, 1].includes(safeEventType)) throw new Error('invalid_input_status')
        await this.callAction('set_input_status', {
            user_id: safeUserId,
            event_type: safeEventType
        }, options)
        return {
            message: `已向 ${safeUserId} 设置输入状态：${presetConfig?.label || safeEventType}。`,
            data: { userId: safeUserId, eventType: safeEventType, preset: preset || '' }
        }
    }
}

module.exports = new QqAccountService()
module.exports.ONLINE_STATUS_PRESETS = ONLINE_STATUS_PRESETS
module.exports.INPUT_STATUS_PRESETS = INPUT_STATUS_PRESETS
