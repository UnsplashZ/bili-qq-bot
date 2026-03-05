#!/usr/bin/env node
'use strict'

const fs = require('fs').promises
const path = require('path')

const ROOT_DIR = process.cwd()
const CONFIG_PATH = path.join(ROOT_DIR, 'config', 'config.json')
const SUBSCRIPTIONS_PATH = path.join(ROOT_DIR, 'data', 'subscriptions.json')
const FOLLOWERS_PATH = path.join(ROOT_DIR, 'data', 'subfollowers.json')

const PRIVATE_GROUP_RE = /^private_\d+$/
const NUMERIC_GROUP_RE = /^\d+$/

function isPrivateGroupId(value) {
    return PRIVATE_GROUP_RE.test(String(value || '').trim())
}

function isNumericGroupId(value) {
    return NUMERIC_GROUP_RE.test(String(value || '').trim())
}

async function fileExists(filePath) {
    try {
        await fs.access(filePath)
        return true
    } catch {
        return false
    }
}

async function readJsonIfExists(filePath) {
    if (!await fileExists(filePath)) return null
    const raw = await fs.readFile(filePath, 'utf8')
    if (!raw.trim()) return null
    return JSON.parse(raw)
}

async function writeJsonWithBackup(filePath, payload) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    if (await fileExists(filePath)) {
        await fs.copyFile(filePath, `${filePath}.bak.${timestamp}`)
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function cleanConfig(configJson, stats) {
    if (!configJson || typeof configJson !== 'object') return false
    let changed = false

    if (configJson.groupConfigs && typeof configJson.groupConfigs === 'object') {
        for (const groupId of Object.keys(configJson.groupConfigs)) {
            if (isPrivateGroupId(groupId)) {
                delete configJson.groupConfigs[groupId]
                stats.privateGroupConfigsRemoved++
                changed = true
            }
        }
    }

    if (Array.isArray(configJson.enabledGroups)) {
        const before = configJson.enabledGroups.length
        configJson.enabledGroups = configJson.enabledGroups
            .map(id => String(id).trim())
            .filter(id => isNumericGroupId(id))
        const removed = before - configJson.enabledGroups.length
        if (removed > 0) {
            stats.nonNumericEnabledGroupsRemoved += removed
            changed = true
        }
    }

    return changed
}

function cleanSubscriptionItemGroupIds(item, stats) {
    if (!item || typeof item !== 'object' || !Array.isArray(item.groupIds)) return false
    const before = item.groupIds.length
    item.groupIds = item.groupIds
        .map(id => String(id).trim())
        .filter(id => !isPrivateGroupId(id))
    const removed = before - item.groupIds.length
    if (removed > 0) {
        stats.privateGroupIdsRemovedFromSubscriptions += removed
        return true
    }
    return false
}

function cleanSubscriptions(subscriptionsJson, stats) {
    if (!subscriptionsJson) return false
    let changed = false

    const cleanupArray = (list) => {
        if (!Array.isArray(list)) return list
        const next = []
        for (const item of list) {
            const itemChanged = cleanSubscriptionItemGroupIds(item, stats)
            if (itemChanged) changed = true
            if (Array.isArray(item?.groupIds) && item.groupIds.length > 0) {
                next.push(item)
            } else if (Array.isArray(item?.groupIds)) {
                stats.emptySubscriptionEntriesRemoved++
                changed = true
            } else {
                next.push(item)
            }
        }
        return next
    }

    if (Array.isArray(subscriptionsJson)) {
        const next = cleanupArray(subscriptionsJson)
        if (next.length !== subscriptionsJson.length) changed = true
        subscriptionsJson.length = 0
        subscriptionsJson.push(...next)
        return changed
    }

    if (typeof subscriptionsJson === 'object') {
        if (Array.isArray(subscriptionsJson.users)) {
            subscriptionsJson.users = cleanupArray(subscriptionsJson.users)
        }
        if (Array.isArray(subscriptionsJson.bangumis)) {
            subscriptionsJson.bangumis = cleanupArray(subscriptionsJson.bangumis)
        }
    }

    return changed
}

function cleanFollowers(followersJson, stats) {
    if (!followersJson || typeof followersJson !== 'object') return false
    let changed = false

    if (followersJson.groupMap && typeof followersJson.groupMap === 'object') {
        for (const groupId of Object.keys(followersJson.groupMap)) {
            if (isPrivateGroupId(groupId)) {
                delete followersJson.groupMap[groupId]
                stats.privateGroupMapEntriesRemoved++
                changed = true
            }
        }
    }

    return changed
}

function printStats(stats, dryRun) {
    const mode = dryRun ? 'DRY-RUN' : 'APPLY'
    console.log(`[cleanup-private-group-artifacts] mode=${mode}`)
    console.log(`- removed groupConfigs private_* entries: ${stats.privateGroupConfigsRemoved}`)
    console.log(`- removed enabledGroups non-numeric entries: ${stats.nonNumericEnabledGroupsRemoved}`)
    console.log(`- removed subscription groupIds private_* entries: ${stats.privateGroupIdsRemovedFromSubscriptions}`)
    console.log(`- removed empty subscription entries: ${stats.emptySubscriptionEntriesRemoved}`)
    console.log(`- removed subfollowers.groupMap private_* entries: ${stats.privateGroupMapEntriesRemoved}`)
}

async function main() {
    const args = new Set(process.argv.slice(2))
    const dryRun = !args.has('--apply')

    const stats = {
        privateGroupConfigsRemoved: 0,
        nonNumericEnabledGroupsRemoved: 0,
        privateGroupIdsRemovedFromSubscriptions: 0,
        emptySubscriptionEntriesRemoved: 0,
        privateGroupMapEntriesRemoved: 0
    }

    const configJson = await readJsonIfExists(CONFIG_PATH)
    const subscriptionsJson = await readJsonIfExists(SUBSCRIPTIONS_PATH)
    const followersJson = await readJsonIfExists(FOLLOWERS_PATH)

    const configChanged = cleanConfig(configJson, stats)
    const subscriptionsChanged = cleanSubscriptions(subscriptionsJson, stats)
    const followersChanged = cleanFollowers(followersJson, stats)

    printStats(stats, dryRun)

    if (dryRun) {
        console.log('[cleanup-private-group-artifacts] no files changed (dry-run).')
        return
    }

    if (configChanged && configJson) {
        await writeJsonWithBackup(CONFIG_PATH, configJson)
    }
    if (subscriptionsChanged && subscriptionsJson) {
        await writeJsonWithBackup(SUBSCRIPTIONS_PATH, subscriptionsJson)
    }
    if (followersChanged && followersJson) {
        await writeJsonWithBackup(FOLLOWERS_PATH, followersJson)
    }

    console.log('[cleanup-private-group-artifacts] done.')
}

main().catch((err) => {
    console.error('[cleanup-private-group-artifacts] failed:', err)
    process.exit(1)
})

