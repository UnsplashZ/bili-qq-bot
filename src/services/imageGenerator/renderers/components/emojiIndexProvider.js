const fs = require('fs')
const path = require('path')
const axios = require('axios')
const {
    createEmojiRecordFromNode,
    normalizeEmojiText
} = require('./biliEmojiRegistry')

const DEFAULT_TTL_MS = 30 * 60 * 1000
const PANEL_BUSINESSES = ['reply', 'dynamic']
const COOKIE_FILE = path.resolve(process.cwd(), 'data/cookies.json')

function readCookieHeader() {
    try {
        if (!fs.existsSync(COOKIE_FILE)) return ''
        const raw = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'))
        return Object.entries(raw)
            .filter(([key, value]) => !key.startsWith('_') && value)
            .map(([key, value]) => `${key}=${value}`)
            .join('; ')
    } catch (_) {
        return ''
    }
}

async function fetchPanelPackages(business, cookieHeader) {
    const headers = {
        'User-Agent': 'Mozilla/5.0'
    }
    if (cookieHeader) headers.Cookie = cookieHeader

    const response = await axios.get('https://api.bilibili.com/x/emote/user/panel/web', {
        params: { business },
        headers,
        timeout: 8000,
        validateStatus: () => true
    })

    if (response.status !== 200 || response.data?.code !== 0) {
        return []
    }

    return response.data?.data?.packages || []
}

async function defaultLoadEmojiIndex() {
    const cookieHeader = readCookieHeader()
    const records = new Map()

    for (const business of PANEL_BUSINESSES) {
        let packages = []
        try {
            packages = await fetchPanelPackages(business, cookieHeader)
        } catch (_) {
            packages = []
        }

        for (const pkg of packages) {
            for (const emote of pkg?.emote || []) {
                const record = createEmojiRecordFromNode({
                    text: emote.text,
                    orig_text: emote.text,
                    emoji: {
                        text: emote.text,
                        icon_url: emote.url,
                        id: emote.id,
                        package_id: emote.package_id || pkg.id
                    }
                })
                if (!record) continue
                const key = normalizeEmojiText(record.rawText)
                if (!key || records.has(key)) continue
                records.set(key, record)
            }
        }
    }

    return Array.from(records.values())
}

class EmojiIndexProvider {
    constructor({ loader = defaultLoadEmojiIndex, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
        this.loader = loader
        this.ttlMs = ttlMs
        this.now = now
        this.index = new Map()
        this.expiresAt = 0
        this.loadingPromise = null
    }

    hasFreshCache() {
        return this.index.size > 0 && this.now() < this.expiresAt
    }

    needsRefresh() {
        return this.index.size === 0 || this.now() >= this.expiresAt
    }

    async loadIndex() {
        if (this.loadingPromise) {
            return this.loadingPromise
        }

        this.loadingPromise = (async () => {
            const records = await this.loader()
            const nextIndex = new Map()
            for (const record of records || []) {
                const rawText = normalizeEmojiText(record?.rawText)
                const iconUrl = String(record?.iconUrl || '').trim()
                if (!rawText || !iconUrl || nextIndex.has(rawText)) continue
                nextIndex.set(rawText, {
                    rawText,
                    iconUrl,
                    emojiId: record?.emojiId ? String(record.emojiId) : '',
                    packageId: record?.packageId ? String(record.packageId) : '',
                    updatedAt: record?.updatedAt || this.now()
                })
            }
            this.index = nextIndex
            this.expiresAt = this.now() + this.ttlMs
        })()

        try {
            await this.loadingPromise
        } finally {
            this.loadingPromise = null
        }
    }

    async ensureLoaded() {
        if (this.hasFreshCache()) return
        await this.loadIndex()
    }

    refreshInBackground() {
        if (!this.needsRefresh() || this.loadingPromise) {
            return this.loadingPromise
        }

        this.loadIndex().catch(() => {
            // Background refresh failures should not break rendering callers.
        })
        return this.loadingPromise
    }

    lookupEmojiByText(text) {
        const rawText = normalizeEmojiText(text)
        if (!rawText) return null
        return this.index.get(rawText) || null
    }
}

let defaultProvider = null

function getDefaultEmojiIndexProvider() {
    if (!defaultProvider) {
        defaultProvider = new EmojiIndexProvider()
    }
    return defaultProvider
}

module.exports = {
    EmojiIndexProvider,
    defaultLoadEmojiIndex,
    getDefaultEmojiIndexProvider
}
