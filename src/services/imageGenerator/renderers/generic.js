const { escapeHtml } = require('../core/formatters');
const { renderEmbeddedResourceCard } = require('./components/media');

function renderGenericContent(data, emojiContext = null) {
    const info = data?.data || {};
    const owner = info.owner || {};
    const hasOwner = Boolean(owner.name || owner.face);
    const ownerFace = owner.face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';
    const ownerName = owner.name || 'Bilibili';
    const subtitle = info.subtitle ? escapeHtml(info.subtitle) : '';
    const resourceCardHtml = renderEmbeddedResourceCard({
        kind: data?.type || 'generic',
        title: info.title || 'Bilibili',
        subtitle: info.subtitle || '',
        desc: info.desc || '',
        cover: info.cover || '',
        stats: info.stats || [],
        badgeText: info.badgeText || '',
        badgeColor: info.badgeColor || ''
    }, { emojiContext });

    return `
        <div class="content">
            ${hasOwner ? `
                <div class="header">
                    <div class="header-left">
                        <div class="avatar-wrapper">
                            <img class="avatar no-frame" src="${ownerFace}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                        </div>
                        <div class="user-info">
                            <span class="user-name">${escapeHtml(ownerName)}</span>
                            ${subtitle ? `<span class="pub-time">${subtitle}</span>` : ''}
                        </div>
                    </div>
                </div>
            ` : (subtitle ? `<div class="pub-time">${subtitle}</div>` : '')}
            ${resourceCardHtml}
        </div>
    `;
}

module.exports = { renderGenericContent };
