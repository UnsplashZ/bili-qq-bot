'use strict'

const { CONFIG_SCHEMA } = require('./schemaV1')
const { clone, valuesEqual } = require('./configUtils')

function mergeMeta(schema, inherited) {
    return {
        secret: Boolean(inherited.secret || schema?.secret),
        effects: [...new Set([...(inherited.effects || []), ...(schema?.effects || [])])],
        deploymentApplyRequired: Boolean(inherited.deploymentApplyRequired || schema?.deploymentApplyRequired)
    }
}

function diffNode(before, after, schema, path, inherited, output) {
    if (valuesEqual(before, after)) return
    const meta = mergeMeta(schema, inherited)

    if (schema?.type === 'object') {
        const keys = new Set([
            ...Object.keys(before || {}),
            ...Object.keys(after || {}),
            ...Object.keys(schema.properties || {})
        ])
        for (const key of keys) {
            const childSchema = schema.properties?.[key]
            if (!childSchema) continue
            diffNode(before?.[key], after?.[key], childSchema, [...path, key], meta, output)
        }
        return
    }

    if (schema?.type === 'map') {
        const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
        for (const key of keys) {
            diffNode(before?.[key], after?.[key], schema.value, [...path, key], meta, output)
        }
        return
    }

    output.push({
        path,
        before: clone(before),
        after: clone(after),
        secret: meta.secret,
        effects: meta.effects,
        deploymentApplyRequired: meta.deploymentApplyRequired
    })
}

function diffConfig(before, after, schema = CONFIG_SCHEMA) {
    const output = []
    diffNode(before, after, schema, [], {}, output)
    return output
}

module.exports = {
    diffConfig
}
