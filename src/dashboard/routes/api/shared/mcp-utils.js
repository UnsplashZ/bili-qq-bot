function stripMcpVersionField(config) {
    const stripped = {}
    if (!config || typeof config !== 'object') return stripped
    for (const [key, value] of Object.entries(config)) {
        if (key === '_version') continue
        stripped[key] = value
    }
    return stripped
}

function deepSortObject(value) {
    if (Array.isArray(value)) {
        return value.map(deepSortObject)
    }
    if (value && typeof value === 'object') {
        const sorted = {}
        for (const key of Object.keys(value).sort()) {
            sorted[key] = deepSortObject(value[key])
        }
        return sorted
    }
    return value
}

function isMcpConfigContentEqual(a, b) {
    const normalizedA = deepSortObject(stripMcpVersionField(a))
    const normalizedB = deepSortObject(stripMcpVersionField(b))
    return JSON.stringify(normalizedA) === JSON.stringify(normalizedB)
}

module.exports = {
    stripMcpVersionField,
    deepSortObject,
    isMcpConfigContentEqual
}

