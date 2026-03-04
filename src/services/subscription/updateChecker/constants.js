const config = require('../../../config')

const DEFAULT_AT_ALL_SOURCES = ['manual', 'cookieSync']
const DEFAULT_AT_ALL_CATEGORIES = [
    'video',
    'dynamic',
    'live',
    'article',
    'bangumi',
    'movie',
    'tv',
    'guocha',
    'doc',
    'variety'
]

const VALID_AT_ALL_SOURCES = new Set(config.SUBSCRIPTION_AT_ALL_SOURCE_KEYS || DEFAULT_AT_ALL_SOURCES)
const VALID_AT_ALL_CATEGORIES = new Set(config.SUBSCRIPTION_AT_ALL_CATEGORY_KEYS || DEFAULT_AT_ALL_CATEGORIES)

const AT_ALL_CAPABILITY_CACHE_TTL_MS = 30 * 1000
const AT_ALL_SEND_FAILURE_CACHE_TTL_MS = 5 * 60 * 1000
const AT_ALL_CAPABILITY_WARMUP_BATCH_SIZE = 5

module.exports = {
    DEFAULT_AT_ALL_SOURCES,
    DEFAULT_AT_ALL_CATEGORIES,
    VALID_AT_ALL_SOURCES,
    VALID_AT_ALL_CATEGORIES,
    AT_ALL_CAPABILITY_CACHE_TTL_MS,
    AT_ALL_SEND_FAILURE_CACHE_TTL_MS,
    AT_ALL_CAPABILITY_WARMUP_BATCH_SIZE
}
