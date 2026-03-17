const { renderVoteCard, getVoteFromModules } = require('./vote')
const { renderEmbeddedResourceCard } = require('./media')
const { renderOpusLinkCards, resolveOpusLinkCards } = require('./opusLinkCard')
const { resolveDynamicCommonCard } = require('./embeddedResourceResolver')

function resolveDynamicSupplementalCards(modules) {
    const safeModules = modules && typeof modules === 'object' ? modules : {}
    const dynamicModule = safeModules.module_dynamic || {}
    return {
        opusLinkCards: resolveOpusLinkCards(dynamicModule),
        vote: getVoteFromModules(safeModules),
        commonCard: resolveDynamicCommonCard(dynamicModule)
    }
}

function renderDynamicSupplementalCards(modules, options = {}) {
    const { emojiContext = null } = options
    const resolved = resolveDynamicSupplementalCards(modules)
    return [
        renderOpusLinkCards(resolved.opusLinkCards, { emojiContext }),
        renderVoteCard(resolved.vote),
        renderEmbeddedResourceCard(resolved.commonCard, { emojiContext })
    ].join('')
}

module.exports = {
    resolveDynamicCommonCard,
    resolveDynamicSupplementalCards,
    renderDynamicSupplementalCards
}
