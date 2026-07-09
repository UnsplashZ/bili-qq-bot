const fs = require('fs')
const path = require('path')

class OfficialIdStore {
    constructor(options = {}) {
        this.groups = new Map()
        this.users = new Map()
        this.members = new Map()
        this.storagePath = options.storagePath || ''
        this.saveTimer = null
        this.load()
    }

    load() {
        if (!this.storagePath || !fs.existsSync(this.storagePath)) return
        try {
            const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'))
            for (const group of Array.isArray(data.groups) ? data.groups : []) {
                if (group?.groupOpenId) this.groups.set(String(group.groupOpenId), group)
            }
            for (const user of Array.isArray(data.users) ? data.users : []) {
                if (user?.userOpenId) this.users.set(String(user.userOpenId), user)
            }
            for (const member of Array.isArray(data.members) ? data.members : []) {
                const key = this.makeMemberKey(member?.groupOpenId, member?.memberOpenId)
                if (key) this.members.set(key, member)
            }
        } catch {}
    }

    serialize() {
        return {
            schemaVersion: 1,
            groups: Array.from(this.groups.values()),
            users: Array.from(this.users.values()),
            members: Array.from(this.members.values())
        }
    }

    scheduleSave() {
        if (!this.storagePath) return
        if (this.saveTimer) clearTimeout(this.saveTimer)
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null
            try {
                fs.mkdirSync(path.dirname(this.storagePath), { recursive: true })
                fs.writeFileSync(this.storagePath, JSON.stringify(this.serialize(), null, 2))
            } catch {}
        }, 50)
        if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref()
    }

    flush() {
        if (!this.storagePath) return
        if (this.saveTimer) {
            clearTimeout(this.saveTimer)
            this.saveTimer = null
        }
        fs.mkdirSync(path.dirname(this.storagePath), { recursive: true })
        fs.writeFileSync(this.storagePath, JSON.stringify(this.serialize(), null, 2))
    }

    upsertGroup(groupOpenId, patch = {}) {
        const id = String(groupOpenId || '').trim()
        if (!id) return null
        const current = this.groups.get(id) || {
            groupOpenId: id,
            groupName: '',
            reachable: true,
            reachabilityReason: 'unknown',
            activeMessageEnabled: null,
            fullMessageEnabled: null,
            atMessageEnabled: null,
            lastEventType: '',
            lastStatusAt: 0,
            updatedAt: 0
        }
        const next = {
            ...current,
            ...patch,
            groupOpenId: id,
            updatedAt: Date.now()
        }
        this.groups.set(id, next)
        this.scheduleSave()
        return next
    }

    setGroupReachability(groupOpenId, reachable, reason = 'event') {
        return this.upsertGroup(groupOpenId, {
            reachable: Boolean(reachable),
            reachabilityReason: reason,
            activeMessageEnabled: Boolean(reachable),
            lastEventType: reason,
            lastStatusAt: Date.now()
        })
    }

    markGroupMessageEvent(groupOpenId, eventType = '') {
        const type = String(eventType || '')
        const patch = {
            reachable: true,
            reachabilityReason: 'observed',
            lastEventType: type,
            lastStatusAt: Date.now()
        }
        if (type === 'GROUP_MESSAGE_CREATE') {
            patch.fullMessageEnabled = true
        }
        if (type === 'GROUP_AT_MESSAGE_CREATE') {
            patch.atMessageEnabled = true
        }
        return this.upsertGroup(groupOpenId, patch)
    }

    makeMemberKey(groupOpenId, memberOpenId) {
        const groupId = String(groupOpenId || '').trim()
        const memberId = String(memberOpenId || '').trim()
        if (!groupId || !memberId) return ''
        return `${groupId}:${memberId}`
    }

    upsertMember(groupOpenId, memberOpenId, patch = {}) {
        const key = this.makeMemberKey(groupOpenId, memberOpenId)
        if (!key) return null
        const current = this.members.get(key) || {
            groupOpenId: String(groupOpenId || '').trim(),
            memberOpenId: String(memberOpenId || '').trim(),
            userOpenId: '',
            nickname: '',
            role: 'member',
            status: 'observed',
            updatedAt: 0
        }
        const next = {
            ...current,
            ...patch,
            groupOpenId: current.groupOpenId,
            memberOpenId: current.memberOpenId,
            updatedAt: Date.now()
        }
        this.members.set(key, next)
        this.scheduleSave()
        return next
    }

    getMember(groupOpenId, memberOpenId) {
        const key = this.makeMemberKey(groupOpenId, memberOpenId)
        return key ? (this.members.get(key) || null) : null
    }

    markGroupMembership(groupOpenId, status) {
        return this.upsertGroup(groupOpenId, {
            reachable: status !== 'left',
            reachabilityReason: status,
            lastEventType: status,
            lastStatusAt: Date.now()
        })
    }

    upsertUser(userOpenId, patch = {}) {
        const id = String(userOpenId || '').trim()
        if (!id) return null
        const current = this.users.get(id) || {
            userOpenId: id,
            nickname: '',
            updatedAt: 0
        }
        const next = {
            ...current,
            ...patch,
            userOpenId: id,
            updatedAt: Date.now()
        }
        this.users.set(id, next)
        this.scheduleSave()
        return next
    }

    getGroup(groupOpenId) {
        return this.groups.get(String(groupOpenId || '').trim()) || null
    }

    toGroupListMap() {
        const map = new Map()
        for (const [groupOpenId, group] of this.groups.entries()) {
            map.set(groupOpenId, {
                group_id: groupOpenId,
                group_name: group.groupName || groupOpenId,
                official: true,
                reachable: group.reachable,
                reachabilityReason: group.reachabilityReason,
                activeMessageEnabled: group.activeMessageEnabled,
                fullMessageEnabled: group.fullMessageEnabled,
                atMessageEnabled: group.atMessageEnabled,
                lastEventType: group.lastEventType || ''
            })
        }
        return map
    }

    getStatus() {
        return {
            groupCount: this.groups.size,
            userCount: this.users.size,
            memberCount: this.members.size,
            groups: Array.from(this.groups.values()).slice(-50).map((group) => ({
                groupOpenId: group.groupOpenId,
                groupName: group.groupName || '',
                reachable: group.reachable,
                reachabilityReason: group.reachabilityReason,
                activeMessageEnabled: group.activeMessageEnabled,
                fullMessageEnabled: group.fullMessageEnabled,
                atMessageEnabled: group.atMessageEnabled,
                lastEventType: group.lastEventType || '',
                lastStatusAt: group.lastStatusAt || 0,
                updatedAt: group.updatedAt
            })),
            members: Array.from(this.members.values()).slice(-50).map((member) => ({
                groupOpenId: member.groupOpenId,
                memberOpenId: member.memberOpenId,
                userOpenId: member.userOpenId || '',
                nickname: member.nickname || '',
                role: member.role || 'member',
                status: member.status || 'observed',
                updatedAt: member.updatedAt
            }))
        }
    }
}

module.exports = OfficialIdStore
