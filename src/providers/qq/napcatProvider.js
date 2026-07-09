const BaseQqProvider = require('./baseProvider')
const { NAPCAT_CAPABILITIES } = require('./capabilities')

class NapcatProvider extends BaseQqProvider {
    constructor(ws = null) {
        super({
            id: 'napcat',
            name: 'NapCat OneBot',
            capabilities: NAPCAT_CAPABILITIES
        })
        this.ws = ws
    }

    setWebSocket(ws) {
        this.ws = ws
    }

    get readyState() {
        return this.ws?.readyState ?? 0
    }

    getStatus() {
        return {
            ...super.getStatus(),
            connectionState: this.readyState === 1 ? 'ready' : 'disconnected',
            wsReadyState: this.readyState
        }
    }
}

module.exports = NapcatProvider
