'use strict'

const BOT_CONTROL_PERMISSION_CLASSES = Object.freeze({
    PUBLIC_READ: 'public_read',
    ADMIN_READ: 'admin_read',
    ADMIN_WRITE: 'admin_write',
    ROOT_PRIVATE_ONLY: 'root_private_only'
})

const BOT_CONTROL_ACTION_DEFINITIONS = Object.freeze({
    'subscription.read': Object.freeze({ permissionClass: BOT_CONTROL_PERMISSION_CLASSES.ADMIN_READ }),
    'subscription.write': Object.freeze({ permissionClass: BOT_CONTROL_PERMISSION_CLASSES.ADMIN_WRITE }),
    'approval.read': Object.freeze({ permissionClass: BOT_CONTROL_PERMISSION_CLASSES.ROOT_PRIVATE_ONLY }),
    'approval.write': Object.freeze({ permissionClass: BOT_CONTROL_PERMISSION_CLASSES.ROOT_PRIVATE_ONLY }),
    'runtime.read': Object.freeze({ permissionClass: BOT_CONTROL_PERMISSION_CLASSES.PUBLIC_READ }),
    'config.read': Object.freeze({ permissionClass: BOT_CONTROL_PERMISSION_CLASSES.ADMIN_READ }),
    'config.write': Object.freeze({ permissionClass: BOT_CONTROL_PERMISSION_CLASSES.ADMIN_WRITE }),
    'context.write': Object.freeze({ permissionClass: BOT_CONTROL_PERMISSION_CLASSES.ADMIN_WRITE })
})

function normalizeAction(action) {
    return String(action || '').trim()
}

function getBotControlActionDefinition(action) {
    const normalizedAction = normalizeAction(action)
    return BOT_CONTROL_ACTION_DEFINITIONS[normalizedAction] || null
}

function getBotControlActionPermissionClass(action) {
    return getBotControlActionDefinition(action)?.permissionClass || null
}

function parseAction(action) {
    const normalizedAction = normalizeAction(action)
    const parts = normalizedAction.split('.')

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(`Unsupported bot-control action: ${normalizedAction || '<empty>'}`)
    }

    return {
        action: normalizedAction,
        namespace: parts[0],
        operation: parts[1]
    }
}

class BotControlRegistry {
    constructor() {
        this.controllers = new Map()
    }

    registerNamespace(namespace, controller) {
        const normalizedNamespace = String(namespace || '').trim()
        if (!normalizedNamespace) {
            throw new Error('Bot-control namespace is required')
        }
        const hasRead = !!controller && typeof controller.read === 'function'
        const hasWrite = !!controller && typeof controller.write === 'function'

        if (!hasRead && !hasWrite) {
            throw new Error(`Bot-control controller must implement read() or write() for namespace: ${normalizedNamespace}`)
        }

        this.controllers.set(normalizedNamespace, controller)
        return this
    }

    getNamespaces() {
        return Array.from(this.controllers.keys())
    }

    getActions() {
        const actions = []

        for (const [namespace, controller] of this.controllers.entries()) {
            if (typeof controller.read === 'function') {
                actions.push(`${namespace}.read`)
            }
            if (typeof controller.write === 'function') {
                actions.push(`${namespace}.write`)
            }
        }

        return actions
    }

    getActionDefinition(action) {
        return getBotControlActionDefinition(action)
    }

    async dispatch({ action, groupId, input = {}, context = {} }) {
        const parsed = parseAction(action)
        const controller = this.controllers.get(parsed.namespace)

        if (!controller) {
            throw new Error(`Unsupported bot-control namespace: ${parsed.namespace}`)
        }
        if (parsed.operation !== 'read' && parsed.operation !== 'write') {
            throw new Error(`Unsupported bot-control operation: ${parsed.operation}`)
        }

        const handler = controller[parsed.operation]
        if (typeof handler !== 'function') {
            throw new Error(`Unsupported bot-control action: ${parsed.action}`)
        }

        return handler.call(controller, {
            action: parsed.action,
            namespace: parsed.namespace,
            operation: parsed.operation,
            permissionClass: getBotControlActionPermissionClass(parsed.action),
            groupId,
            input,
            context
        })
    }
}

module.exports = {
    BOT_CONTROL_PERMISSION_CLASSES,
    BotControlRegistry,
    getBotControlActionDefinition,
    getBotControlActionPermissionClass,
    parseAction
}
