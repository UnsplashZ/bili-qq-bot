'use strict'

const fs = require('fs')
const path = require('path')
const { sha256 } = require('../common/atomicFile')
const { readPrivateFile } = require('../common/privateFile')
const { MigrationError } = require('../common/errors')

const STRONG_JSON_FILES = [
    { name: 'subscriptions', relativePath: 'subscriptions.json', required: false },
    { name: 'subscriptions_backup', relativePath: 'subscriptions.json.bak', required: false },
    { name: 'subfollowers', relativePath: 'subfollowers.json', required: false },
    { name: 'subfollowers_backup', relativePath: 'subfollowers.json.bak', required: false },
    { name: 'subscription_state', relativePath: 'subscription_state.json', required: false },
    { name: 'subscription_state_backup', relativePath: 'subscription_state.json.bak', required: false },
    { name: 'subscription_delivery', relativePath: 'subscription_delivery.json', required: false },
    { name: 'subscription_delivery_backup', relativePath: 'subscription_delivery.json.bak', required: false },
    { name: 'qq_official_id_store', relativePath: 'qq-official-id-store.json', required: false }
]

const PRESERVE_PATHS = [
    'cookies.json',
    'cookies_map.json',
    'agent',
    'contexts',
    'profiles',
    'vectors'
]

const ANCHOR_KEYS = new Set([
    'lastDynamicId',
    'lastLiveStatus',
    'lastVideoId',
    'lastVideoCreated',
    'lastArticleId',
    'lastArticlePublishTime',
    'lastEpId',
    'roomId',
    'lastRoomId',
    'videoId',
    'articleId',
    'dynamicId',
    'baselineId',
    'baselineRoomId'
])

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (!isPlainObject(value)) return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

function canonicalHash(value) {
    return sha256(JSON.stringify(canonicalize(value)))
}

function parseJsonBuffer(rawBuffer) {
    let value
    try {
        value = JSON.parse(rawBuffer.toString('utf8'))
    } catch (error) {
        throw new MigrationError('DATA_JSON_INVALID')
    }
    if (value === null || typeof value !== 'object') throw new MigrationError('DATA_JSON_ROOT_INVALID')
    return value
}

function collectAnchors(value, prefix = '', output = {}) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectAnchors(item, `${prefix}[${index}]`, output))
        return output
    }
    if (!isPlainObject(value)) return output
    for (const [key, item] of Object.entries(value)) {
        const nextPath = prefix ? `${prefix}.${key}` : key
        if (ANCHOR_KEYS.has(key) && item !== undefined) output[nextPath] = item
        if (item && typeof item === 'object') collectAnchors(item, nextPath, output)
    }
    return output
}

function collectSubscriptionStateAnchors(value, output = {}) {
    const users = isPlainObject(value?.users) ? value.users : {}
    const scopedFields = [
        ['video', 'lastCreated'],
        ['article', 'lastPublishTime'],
        ['live', 'lastStatus']
    ]
    for (const [uid, state] of Object.entries(users)) {
        if (!isPlainObject(state)) continue
        for (const [namespace, field] of scopedFields) {
            const scoped = state[namespace]
            if (!isPlainObject(scoped) || !Object.prototype.hasOwnProperty.call(scoped, field)) continue
            output[`users.${uid}.${namespace}.${field}`] = scoped[field]
        }
    }
    return output
}

function countObjects(value) {
    if (Array.isArray(value)) return value.length
    if (isPlainObject(value)) {
        if (isPlainObject(value.records)) return Object.keys(value.records).length
        return Object.keys(value).length
    }
    return 0
}

function collectDeliveryRecords(value) {
    const rawRecords = isPlainObject(value?.records) ? value.records : (isPlainObject(value) ? value : {})
    const records = []
    for (const [key, record] of Object.entries(rawRecords)) {
        if (!isPlainObject(record)) continue
        records.push({
            key: String(record.key || key),
            groupId: String(record.groupId || ''),
            type: String(record.type || ''),
            contentId: String(record.contentId || ''),
            deliveryPart: String(record.deliveryPart || 'main'),
            deliveredAt: Number(record.deliveredAt || 0)
        })
    }
    records.sort((left, right) => left.key.localeCompare(right.key))
    return records
}

function summarizeJson(name, value, rawBuffer) {
    const anchors = collectAnchors(value)
    if (name === 'subscription_state' || name === 'subscription_state_backup') {
        collectSubscriptionStateAnchors(value, anchors)
    }
    const summary = {
        present: true,
        bytes: rawBuffer.length,
        hash: sha256(rawBuffer),
        canonicalHash: canonicalHash(value),
        count: countObjects(value),
        anchors
    }
    if (name === 'subscription_delivery' || name === 'subscription_delivery_backup') {
        summary.deliveryRecords = collectDeliveryRecords(value)
    }
    if (name === 'qq_official_id_store') {
        if (value.schemaVersion !== 1 || !Array.isArray(value.groups) || !Array.isArray(value.users) || !Array.isArray(value.members)) {
            throw new MigrationError('DATA_OFFICIAL_ID_SCHEMA_INVALID')
        }
        const identities = []
        const seen = new Set()
        const appendIdentity = (kind, identity, item) => {
            if (!isPlainObject(item) || !identity || seen.has(`${kind}:${identity}`)) {
                throw new MigrationError('DATA_OFFICIAL_ID_SCHEMA_INVALID')
            }
            seen.add(`${kind}:${identity}`)
            identities.push(`${kind}:${identity}`)
        }
        for (const group of value.groups) appendIdentity('group', String(group?.groupOpenId || '').trim(), group)
        for (const user of value.users) appendIdentity('user', String(user?.userOpenId || '').trim(), user)
        for (const member of value.members) {
            const groupOpenId = String(member?.groupOpenId || '').trim()
            const memberOpenId = String(member?.memberOpenId || '').trim()
            appendIdentity('member', groupOpenId && memberOpenId ? `${groupOpenId}:${memberOpenId}` : '', member)
        }
        identities.sort()
        const canonicalOfficial = {
            schemaVersion: 1,
            groups: [...value.groups].sort((a, b) => String(a.groupOpenId).localeCompare(String(b.groupOpenId))).map(canonicalize),
            users: [...value.users].sort((a, b) => String(a.userOpenId).localeCompare(String(b.userOpenId))).map(canonicalize),
            members: [...value.members].sort((a, b) => `${a.groupOpenId}:${a.memberOpenId}`.localeCompare(`${b.groupOpenId}:${b.memberOpenId}`)).map(canonicalize)
        }
        summary.idCounts = {
            groups: value.groups.length,
            users: value.users.length,
            members: value.members.length
        }
        summary.identityHash = sha256(identities.join('\n'))
        summary.canonicalHash = canonicalHash(canonicalOfficial)
    }
    return summary
}

function walkPath(rootPath) {
    const stat = fs.lstatSync(rootPath)
    if (stat.isSymbolicLink()) throw new MigrationError('DATA_SYMLINK_FORBIDDEN')
    if (stat.isFile()) {
        const data = readPrivateFile(rootPath, { mode: null }).data
        return { fileCount: 1, bytes: data.length, hash: sha256(data) }
    }
    if (!stat.isDirectory()) return { fileCount: 0, bytes: 0, hash: sha256('') }
    const entries = []
    let bytes = 0
    let fileCount = 0
    const visit = (dirPath, relativeBase = '') => {
        for (const entry of fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const fullPath = path.join(dirPath, entry.name)
            const relativePath = path.posix.join(relativeBase, entry.name)
            const entryStat = fs.lstatSync(fullPath)
            if (entryStat.isSymbolicLink()) throw new MigrationError('DATA_SYMLINK_FORBIDDEN')
            if (entryStat.isDirectory()) {
                visit(fullPath, relativePath)
            } else if (entryStat.isFile()) {
                const data = readPrivateFile(fullPath, { mode: null }).data
                entries.push(`${relativePath}:${data.length}:${sha256(data)}`)
                bytes += data.length
                fileCount += 1
            }
        }
    }
    visit(rootPath)
    return { fileCount, bytes, hash: sha256(entries.join('\n')) }
}

function discoverPreservePaths(root) {
    const paths = new Set(PRESERVE_PATHS)
    let entries = []
    try {
        entries = fs.readdirSync(root, { withFileTypes: true })
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error
    }
    for (const entry of entries) {
        if (entry.isFile() && /^cookies_[0-9]+\.json$/.test(entry.name)) paths.add(entry.name)
    }
    return [...paths].sort()
}

function scanDataInventory(dataDir, options = {}) {
    const root = path.resolve(dataDir)
    const inventory = {
        version: 1,
        generatedAt: options.generatedAt || new Date().toISOString(),
        strong: {},
        preserve: {}
    }
    for (const descriptor of STRONG_JSON_FILES) {
        const filePath = path.join(root, descriptor.relativePath)
        let candidateStat
        try {
            candidateStat = fs.lstatSync(filePath)
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
        }
        if (!candidateStat) {
            if (descriptor.required) throw new MigrationError('DATA_REQUIRED_FILE_MISSING')
            inventory.strong[descriptor.name] = { present: false }
            continue
        }
        if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) throw new MigrationError('DATA_FILE_UNSAFE')
        let raw
        try {
            raw = readPrivateFile(filePath, { mode: null }).data
        } catch (error) {
            if (error?.code === 'ENOENT') throw new MigrationError('DATA_FILE_CHANGED_DURING_SCAN')
            throw error
        }
        const value = parseJsonBuffer(raw)
        inventory.strong[descriptor.name] = summarizeJson(descriptor.name, value, raw)
    }
    for (const relativePath of discoverPreservePaths(root)) {
        const targetPath = path.join(root, relativePath)
        try {
            inventory.preserve[relativePath] = { present: true, ...walkPath(targetPath) }
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
            inventory.preserve[relativePath] = { present: false }
        }
    }
    inventory.fingerprint = sha256(JSON.stringify({ strong: inventory.strong, preserve: inventory.preserve }))
    return inventory
}

function compareAnchorMaps(before, after, logicalName) {
    for (const [anchorPath, value] of Object.entries(before || {})) {
        if (!Object.prototype.hasOwnProperty.call(after || {}, anchorPath)) {
            throw new MigrationError('DATA_ANCHOR_MISSING', 'DATA_ANCHOR_MISSING', { logicalName, anchorPath })
        }
        if (JSON.stringify(after[anchorPath]) !== JSON.stringify(value)) {
            throw new MigrationError('DATA_ANCHOR_CHANGED', 'DATA_ANCHOR_CHANGED', { logicalName, anchorPath })
        }
    }
}

function compareDataInventories(before, after, options = {}) {
    const touchedPaths = new Set(options.touchedPaths || [])
    const touchedValidators = options.touchedValidators || {}
    const knownPaths = new Set([
        ...STRONG_JSON_FILES.map((descriptor) => `strong.${descriptor.name}`),
        ...[...new Set([...Object.keys(before.preserve || {}), ...Object.keys(after.preserve || {})])]
            .map((relativePath) => `preserve.${relativePath}`)
    ])
    for (const touchedPath of touchedPaths) {
        if (!knownPaths.has(touchedPath)) throw new MigrationError('DATA_TOUCHED_PATH_UNKNOWN')
        if (typeof touchedValidators[touchedPath] !== 'function') throw new MigrationError('DATA_TOUCHED_VALIDATOR_REQUIRED')
    }
    const validateTouched = (logicalPath, left, right) => {
        if (!touchedPaths.has(logicalPath)) return false
        if (touchedValidators[logicalPath](left, right) !== true) throw new MigrationError('DATA_TOUCHED_VALIDATION_FAILED')
        return true
    }
    for (const descriptor of STRONG_JSON_FILES) {
        const left = before.strong[descriptor.name] || { present: false }
        const right = after.strong[descriptor.name] || { present: false }
        const logicalPath = `strong.${descriptor.name}`
        if (left.present && !right.present) throw new MigrationError('DATA_STRONG_FILE_LOST')
        if (!left.present) {
            if (right.present && !validateTouched(logicalPath, left, right)) throw new MigrationError('DATA_UNDECLARED_STRONG_CHANGE')
            continue
        }
        if (right.count < left.count && !options.allowCountDecrease?.includes(descriptor.name)) {
            throw new MigrationError('DATA_COUNT_DECREASED')
        }
        compareAnchorMaps(left.anchors, right.anchors, descriptor.name)
        if (descriptor.name === 'subscription_delivery' || descriptor.name === 'subscription_delivery_backup') {
            const afterRecords = new Map((right.deliveryRecords || []).map((record) => [record.key, record]))
            for (const record of left.deliveryRecords || []) {
                const afterRecord = afterRecords.get(record.key)
                if (!afterRecord) throw new MigrationError('DATA_DELIVERY_RECORD_LOST')
                if (JSON.stringify(afterRecord) !== JSON.stringify(record)) {
                    throw new MigrationError('DATA_DELIVERY_RECORD_CHANGED')
                }
            }
        }
        if (descriptor.name === 'qq_official_id_store') {
            for (const key of ['groups', 'users', 'members']) {
                if ((right.idCounts?.[key] || 0) < (left.idCounts?.[key] || 0)) {
                    throw new MigrationError('DATA_OFFICIAL_ID_COUNT_DECREASED')
                }
            }
            if (right.identityHash !== left.identityHash) throw new MigrationError('DATA_OFFICIAL_IDENTITY_CHANGED')
        }
        if (left.canonicalHash !== right.canonicalHash && !validateTouched(logicalPath, left, right)) {
            throw new MigrationError('DATA_UNDECLARED_STRONG_CHANGE')
        }
    }
    for (const [relativePath, left] of Object.entries(before.preserve || {})) {
        const right = after.preserve?.[relativePath] || { present: false }
        const logicalPath = `preserve.${relativePath}`
        if (left.present && !right.present) throw new MigrationError('DATA_PRESERVE_PATH_LOST')
        if (left.present && right.fileCount < left.fileCount && !options.allowPreserveDecrease) {
            throw new MigrationError('DATA_PRESERVE_COUNT_DECREASED')
        }
        if (left.present !== right.present || (left.present && left.hash !== right.hash)) {
            if (!validateTouched(logicalPath, left, right)) throw new MigrationError('DATA_UNDECLARED_PRESERVE_CHANGE')
        }
    }
    return { valid: true }
}

module.exports = {
    STRONG_JSON_FILES,
    PRESERVE_PATHS,
    ANCHOR_KEYS,
    scanDataInventory,
    compareDataInventories,
    collectAnchors,
    collectSubscriptionStateAnchors,
    collectDeliveryRecords,
    canonicalHash
}
