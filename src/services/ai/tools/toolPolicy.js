'use strict'

function matchesListConstraint(value, allowedValues) {
    if (!Array.isArray(allowedValues) || allowedValues.length === 0) {
        return true
    }

    return allowedValues.includes(value)
}

function isToolVisible(tool, context = {}) {
    if (!tool || typeof tool !== 'object') {
        return false
    }

    if (Array.isArray(context.deniedToolNames) && context.deniedToolNames.includes(tool.name)) {
        return false
    }

    if (context.allowLocalTools === false && tool.source === 'local') {
        return false
    }

    if (context.allowMcpTools === false && tool.source === 'mcp') {
        return false
    }

    if (!matchesListConstraint(tool.source, context.visibleSources)) {
        return false
    }

    if (!matchesListConstraint(tool.riskClass, context.visibleRiskClasses)) {
        return false
    }

    if (Array.isArray(context.allowedToolNames) && context.allowedToolNames.length > 0) {
        return context.allowedToolNames.includes(tool.name)
    }

    return true
}

function filterVisibleTools(tools, context = {}) {
    return (Array.isArray(tools) ? tools : []).filter(tool => isToolVisible(tool, context))
}

module.exports = {
    isToolVisible,
    filterVisibleTools
}
