'use strict'

const YAML = require('yaml')
const { ConfigParseError } = require('./errors')

const DEFAULT_LIMITS = Object.freeze({
    maxBytes: 1024 * 1024,
    maxDepth: 32,
    maxNodes: 50000,
    maxAliases: 50
})

const SAFE_TAGS = new Set([
    'tag:yaml.org,2002:null',
    'tag:yaml.org,2002:bool',
    'tag:yaml.org,2002:int',
    'tag:yaml.org,2002:float',
    'tag:yaml.org,2002:str',
    'tag:yaml.org,2002:seq',
    'tag:yaml.org,2002:map'
])

function errorLocation(error) {
    const first = Array.isArray(error?.linePos) ? error.linePos[0] : null
    return {
        line: first?.line ?? null,
        column: first?.col ?? null
    }
}

function assertDocumentSafety(document, limits) {
    let nodeCount = 0
    let aliasCount = 0
    const ancestors = new Set()

    function visit(node, depth) {
        if (!node) return
        nodeCount += 1
        if (nodeCount > limits.maxNodes) {
            throw new ConfigParseError('YAML node limit exceeded')
        }
        if (depth > limits.maxDepth) {
            throw new ConfigParseError('YAML depth limit exceeded')
        }
        if (node.tag && !SAFE_TAGS.has(node.tag)) {
            throw new ConfigParseError('Custom YAML tags are not allowed')
        }
        if (YAML.isAlias(node)) {
            aliasCount += 1
            if (aliasCount > limits.maxAliases) {
                throw new ConfigParseError('YAML alias limit exceeded')
            }
            return
        }
        if (ancestors.has(node)) {
            throw new ConfigParseError('Cyclic YAML structure is not allowed')
        }

        ancestors.add(node)
        if (YAML.isMap(node)) {
            for (const pair of node.items) {
                if (YAML.isScalar(pair.key) && pair.key.value === '<<') {
                    throw new ConfigParseError('YAML merge keys are not allowed')
                }
                visit(pair.key, depth + 1)
                visit(pair.value, depth + 1)
            }
        } else if (YAML.isSeq(node)) {
            for (const item of node.items) visit(item, depth + 1)
        }
        ancestors.delete(node)
    }

    visit(document.contents, 0)
}

function assertNoMaterializedCycles(value) {
    const ancestors = new Set()
    function visit(node) {
        if (!node || typeof node !== 'object') return
        if (ancestors.has(node)) throw new ConfigParseError('Cyclic YAML structure is not allowed')
        ancestors.add(node)
        if (Array.isArray(node)) {
            for (const child of node) visit(child)
        } else {
            for (const child of Object.values(node)) visit(child)
        }
        ancestors.delete(node)
    }
    visit(value)
}

function parseYamlDocument(source, options = {}) {
    if (typeof source !== 'string') {
        throw new ConfigParseError('Configuration source must be a string')
    }
    const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) }
    if (Buffer.byteLength(source, 'utf8') > limits.maxBytes) {
        throw new ConfigParseError('Configuration file exceeds size limit')
    }

    let document
    try {
        document = YAML.parseDocument(source, {
            version: '1.2',
            schema: 'core',
            uniqueKeys: true,
            strict: true,
            prettyErrors: true,
            keepSourceTokens: true
        })
    } catch (error) {
        throw new ConfigParseError('Unable to parse YAML', { ...errorLocation(error), cause: error })
    }

    if (document.errors.length > 0) {
        const error = document.errors[0]
        throw new ConfigParseError(error.code || 'Invalid YAML document', {
            ...errorLocation(error),
            cause: error
        })
    }
    assertDocumentSafety(document, limits)

    let value
    try {
        value = document.toJS({ maxAliasCount: limits.maxAliases, mapAsMap: false })
    } catch (error) {
        throw new ConfigParseError('Unable to materialize YAML document', { cause: error })
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ConfigParseError('Configuration root must be a mapping')
    }
    assertNoMaterializedCycles(value)

    return { document, value }
}

function createYamlDocument(value) {
    const document = new YAML.Document(value, {
        version: '1.2',
        schema: 'core'
    })
    document.directivesEndMarker = false
    document.commentBefore = 'Bili QQ Bot unified configuration. Managed values may contain secrets.'
    return document
}

function cloneYamlDocument(document) {
    return parseYamlDocument(String(document)).document
}

function stringifyYamlDocument(document) {
    const source = String(document)
    return source.endsWith('\n') ? source : `${source}\n`
}

module.exports = {
    DEFAULT_LIMITS,
    parseYamlDocument,
    createYamlDocument,
    cloneYamlDocument,
    stringifyYamlDocument
}
