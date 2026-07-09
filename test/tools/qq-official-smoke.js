#!/usr/bin/env node
'use strict'

const OfficialTokenManager = require('../../src/providers/qq/official/tokenManager')
const OfficialOpenApiClient = require('../../src/providers/qq/official/openapiClient')
const config = require('../../src/config')

function printSummary(summary) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

function redactString(value) {
    let text = String(value || '')
    const needles = [
        process.env.QQ_OFFICIAL_CLIENT_SECRET,
        process.env.QQ_OFFICIAL_APP_ID,
        process.env.WS_TOKEN,
        config.qqOfficialClientSecret
    ].map((item) => String(item || '').trim()).filter((item) => item.length >= 4)

    for (const needle of needles) {
        text = text.split(needle).join('[REDACTED]')
    }

    return text
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
        .replace(/access_token["'=:\s]+[A-Za-z0-9._~+/=-]+/gi, 'access_token=[REDACTED]')
        .replace(/client_secret["'=:\s]+[^&\s"}]+/gi, 'client_secret=[REDACTED]')
        .replace(/authorization["'=:\s]+[^,\s"}]+/gi, 'authorization=[REDACTED]')
}

function createFakeFetch() {
    return async (url) => {
        const text = String(url || '')
        if (text.includes('/gateway')) {
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    url: 'wss://gateway.example.invalid/websocket',
                    shards: 1,
                    session_start_limit: {
                        total: 1000,
                        remaining: 999,
                        reset_after: 0,
                        max_concurrency: 1
                    }
                })
            }
        }
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                access_token: 'dry-run-token',
                expires_in: 7200
            })
        }
    }
}

async function run() {
    const real = process.env.QQ_OFFICIAL_SMOKE_REAL === '1' || process.argv.includes('--real')
    const fetchImpl = real ? global.fetch : createFakeFetch()
    const appId = real ? config.qqOfficialAppId : 'dry-run-appid'
    const clientSecret = real ? config.qqOfficialClientSecret : 'dry-run-secret'
    const tokenUrl = real ? config.qqOfficialTokenUrl : 'https://bots.qq.com/app/getAppAccessToken'
    const apiBase = real ? config.qqOfficialApiBase : 'https://api.sgroup.qq.com'

    if (real && (!appId || !clientSecret)) {
        throw new Error('qq_official_smoke_missing_credentials')
    }

    const tokenManager = new OfficialTokenManager({
        appId,
        clientSecret,
        tokenUrl,
        fetchImpl,
        logger: {
            logEvent() {},
            getErrorMessage: (error) => error?.message || String(error)
        }
    })
    const openapi = new OfficialOpenApiClient({
        apiBase,
        tokenManager,
        fetchImpl,
        logger: {
            logEvent() {},
            getErrorMessage: (error) => error?.message || String(error)
        }
    })

    await tokenManager.getAccessToken()
    const gateway = await openapi.getGatewayBot()
    const sessionLimit = gateway.session_start_limit || gateway.sessionStartLimit || {}

    printSummary({
        mode: real ? 'real' : 'dry-run',
        token: tokenManager.getStatus(),
        gateway: {
            hasUrl: Boolean(gateway.url || gateway.endpoint),
            shards: Number(gateway.shards || gateway.shard_count || 1),
            sessionStartLimit: {
                total: sessionLimit.total ?? null,
                remaining: sessionLimit.remaining ?? null,
                resetAfter: sessionLimit.reset_after ?? sessionLimit.resetAfter ?? null,
                maxConcurrency: sessionLimit.max_concurrency ?? sessionLimit.maxConcurrency ?? null
            }
        }
    })
}

if (require.main === module) {
    run().catch((error) => {
        printSummary({
            status: 'failed',
            mode: process.env.QQ_OFFICIAL_SMOKE_REAL === '1' || process.argv.includes('--real') ? 'real' : 'dry-run',
            error: redactString(error?.message || String(error))
        })
        process.exitCode = 1
    })
}

module.exports = {
    run,
    redactString
}
