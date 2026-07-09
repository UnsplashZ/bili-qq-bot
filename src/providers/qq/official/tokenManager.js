const { redactSensitive } = require('../../../utils/redactSensitive')

const DEFAULT_TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
const REFRESH_SKEW_MS = 5 * 60 * 1000

class OfficialTokenManager {
    constructor(options = {}) {
        this.appId = String(options.appId || '').trim()
        this.clientSecret = String(options.clientSecret || '').trim()
        this.tokenUrl = String(options.tokenUrl || DEFAULT_TOKEN_URL).trim()
        this.fetchImpl = options.fetchImpl || global.fetch
        this.logger = options.logger || null
        this.refreshSkewMs = Number(options.refreshSkewMs || REFRESH_SKEW_MS)
        this.accessToken = ''
        this.expiresAt = 0
        this.refreshInFlight = null
    }

    validateConfig() {
        if (!this.appId) throw new Error('qq_official_app_id_missing')
        if (!this.clientSecret) throw new Error('qq_official_client_secret_missing')
        if (typeof this.fetchImpl !== 'function') throw new Error('fetch_unavailable')
    }

    getTokenTtlSeconds(now = Date.now()) {
        if (!this.accessToken || !this.expiresAt) return 0
        return Math.max(0, Math.floor((this.expiresAt - now) / 1000))
    }

    hasUsableToken(now = Date.now()) {
        return Boolean(this.accessToken && this.expiresAt - this.refreshSkewMs > now)
    }

    async getAccessToken(options = {}) {
        if (!options.forceRefresh && this.hasUsableToken()) {
            return this.accessToken
        }
        return this.refreshAccessToken(options)
    }

    async getAuthorizationHeader(options = {}) {
        const token = await this.getAccessToken(options)
        return `QQBot ${token}`
    }

    async refreshAccessToken(options = {}) {
        if (this.refreshInFlight && !options.forceRefresh) {
            return this.refreshInFlight
        }

        this.validateConfig()

        this.refreshInFlight = (async () => {
            try {
                const response = await this.fetchImpl(this.tokenUrl, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        appId: this.appId,
                        clientSecret: this.clientSecret
                    })
                })

                const text = await response.text()
                let body = {}
                if (text) {
                    try {
                        body = JSON.parse(text)
                    } catch {
                        body = {}
                    }
                }

                if (!response.ok || !body.access_token) {
                    const code = body.code ?? response.status
                    throw new Error(`qq_token_refresh_failed:${response.status}:${code}`)
                }

                const expiresInSeconds = Number(body.expires_in || body.expiresIn || 0)
                const ttlMs = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
                    ? expiresInSeconds * 1000
                    : 7200 * 1000

                this.accessToken = String(body.access_token)
                this.expiresAt = Date.now() + ttlMs

                this.logger?.logEvent?.('info', 'QQ', 'svc:qq:token', 'token-refreshed', {
                    appId: this.appId,
                    ttlSeconds: Math.floor(ttlMs / 1000)
                })
                return this.accessToken
            } catch (error) {
                if (this.accessToken && this.expiresAt > Date.now()) {
                    this.logger?.logEvent?.('warn', 'QQ', 'svc:qq:token', 'token-refresh-failed-using-cached', {
                        error: this.logger?.getErrorMessage ? this.logger.getErrorMessage(error) : String(error)
                    })
                    return this.accessToken
                }
                throw error
            } finally {
                this.refreshInFlight = null
            }
        })()

        return this.refreshInFlight
    }

    getStatus() {
        return redactSensitive({
            configured: Boolean(this.appId && this.clientSecret),
            appId: this.appId,
            tokenTtlSeconds: this.getTokenTtlSeconds(),
            refreshInFlight: Boolean(this.refreshInFlight)
        })
    }
}

module.exports = OfficialTokenManager
module.exports.DEFAULT_TOKEN_URL = DEFAULT_TOKEN_URL
