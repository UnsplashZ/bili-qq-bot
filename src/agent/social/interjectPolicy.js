function isSocialAction(action) {
    return action === 'casual_interject' || action === 'ambient_react'
}

module.exports = {
    isSocialAction
}
