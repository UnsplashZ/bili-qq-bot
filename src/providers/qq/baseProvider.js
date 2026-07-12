const { EventEmitter } = require('events')

class BaseQqProvider extends EventEmitter {
    constructor({ id, name, capabilities = [] } = {}) {
        super()
        this.id = id || 'unknown'
        this.name = name || this.id
        this.capabilities = capabilities instanceof Set ? capabilities : new Set(capabilities)
    }

    hasCapability(capability) {
        return this.capabilities.has(capability)
    }

    listCapabilities() {
        return Array.from(this.capabilities)
    }

    getStatus() {
        return {
            id: this.id,
            name: this.name,
            capabilities: this.listCapabilities()
        }
    }
}

module.exports = BaseQqProvider
