'use strict'

const { buildPromptProfileLine } = require('../userProfileService')

function getRagSearchOptions(intentType, currentUserId, ragMode) {
    const options = {}
    const normalizedRagMode = ragMode === 'normal' ? 'normal' : 'strict'

    if (intentType === 'self_identity' && currentUserId) {
        if (normalizedRagMode === 'strict') {
            options.strictUserId = String(currentUserId)
            options.crossUserPenalty = 0.2
        } else {
            options.crossUserPenalty = 0.08
        }
    }

    if (intentType === 'bot_identity') {
        options.includeRoles = ['assistant']
    }

    if (intentType === 'admin_action') {
        options.crossUserPenalty = 0.12
    }

    return options
}

async function collectAugments({
    contextKey,
    groupId,
    userId,
    currentSpeakerId,
    currentText,
    context,
    intentType,
    ragMode,
    profileEnabled,
    structuredSelectedContext,
    vectorSearch,
    getActiveProfiles,
    isRagEnabledForGroup,
    log
}) {
    let ragEnabled = isRagEnabledForGroup(groupId)
    if (intentType === 'bot_identity' && ragMode === 'strict') {
        ragEnabled = false
        log('debug', 'rag-skipped', {
            reason: 'bot_identity_strict'
        })
    }

    const hybridSearchOptions = getRagSearchOptions(intentType, currentSpeakerId, ragMode)
    let memories = []
    if (ragEnabled) {
        try {
            memories = await vectorSearch(contextKey, currentText, undefined, userId, hybridSearchOptions)
        } catch (error) {
            log('error', 'rag-failed', {
                error: String(error?.message || error || '')
            })
        }
    }

    let profileText = ''
    if (profileEnabled && intentType !== 'bot_identity') {
        try {
            let recentUserIds = []
            if (intentType === 'self_identity' && currentSpeakerId) {
                recentUserIds = [String(currentSpeakerId)]
            } else {
                recentUserIds = [...new Set(
                    context.filter(m => m.role === 'user' && (m.speakerId || m.userId))
                        .map(m => String(m.speakerId || m.userId))
                        .reverse()
                )].slice(0, 5)
            }

            if (recentUserIds.length > 0) {
                const profiles = await getActiveProfiles(contextKey, recentUserIds)
                const validProfiles = profiles
                    .map(profile => buildPromptProfileLine(profile))
                    .filter(Boolean)
                if (validProfiles.length > 0) {
                    profileText = validProfiles.join('\n\n')
                }
            }
        } catch (error) {
            log('error', 'profile-injection-failed', {
                error: String(error?.message || error || '')
            })
        }
    }

    log('info', 'rag-ready', {
        enabled: ragEnabled,
        intentType,
        memoryCount: memories.length
    })

    if (profileText) {
        const profileCount = profileText.split('\n\n').filter(Boolean).length
        log('info', 'profile-ready', {
            profileCount
        })
    }

    log('info', 'augment-ready', {
        ragEnabled,
        memoryCount: memories.length,
        hasProfileText: !!profileText,
        structured: !!structuredSelectedContext
    })

    return {
        memories,
        profileText,
        ragEnabled,
        hybridSearchOptions,
        promptFragments: {
            structuredSelectedContext: !!structuredSelectedContext
        }
    }
}

module.exports = {
    getRagSearchOptions,
    collectAugments
}
