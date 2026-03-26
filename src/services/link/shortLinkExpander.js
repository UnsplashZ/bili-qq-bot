'use strict'

const https = require('https')
const logger = require('../../utils/logger')

const shortLinkRegex = /https?:\/\/b23\.tv\/[a-zA-Z0-9]+/

function expandShortUrl(shortUrl) {
    return new Promise((resolve) => {
        let normalizedShortUrl = String(shortUrl || '')
        if (!normalizedShortUrl.startsWith('http')) {
            normalizedShortUrl = `https://${normalizedShortUrl}`
        }

        logger.logEvent('info', 'LINK', '', 'short-link-expand-start', {
            shortUrl: normalizedShortUrl
        })

        const options = {
            method: 'HEAD',
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        }

        const req = https.request(normalizedShortUrl, options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                logger.logEvent('info', 'LINK', '', 'short-link-expanded', {
                    shortUrl: normalizedShortUrl,
                    expandedUrl: res.headers.location,
                    statusCode: res.statusCode
                })
                resolve(res.headers.location)
            } else {
                logger.logEvent('info', 'LINK', '', 'short-link-expand-noop', {
                    shortUrl: normalizedShortUrl,
                    statusCode: res.statusCode
                })
                resolve(normalizedShortUrl)
            }
        })

        req.on('timeout', () => {
            logger.logEvent('warn', 'LINK', '', 'short-link-expand-timeout', {
                shortUrl: normalizedShortUrl
            })
            req.destroy()
            resolve(normalizedShortUrl)
        })

        req.on('error', (error) => {
            logger.logEvent('error', 'LINK', '', 'short-link-expand-failed', {
                shortUrl: normalizedShortUrl,
                error: logger.getErrorMessage(error)
            })
            resolve(normalizedShortUrl)
        })

        req.end()
    })
}

module.exports = {
    shortLinkRegex,
    expandShortUrl
}
