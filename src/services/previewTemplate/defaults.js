'use strict'

const { CARD_TYPES, TYPE_LABELS, ROLE_LABELS } = require('./schema')

const DEFAULT_SIGNATURE = 'legacy-parity-v3'
const SCHEMA_VERSION = 3

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function node(id, type, role, parentId, extra = {}) {
    return {
        id,
        type,
        role,
        label: extra.label || ROLE_LABELS[role] || id,
        parentId,
        visible: extra.visible !== false,
        locked: extra.locked === true,
        layout: extra.layout || { mode: 'flow' },
        style: extra.style || {},
        binding: extra.binding || {},
        items: extra.items,
        hideWhenEmpty: extra.hideWhenEmpty === true
    }
}

function buildTemplate(type, nodes, childrenByParentId) {
    const nodesById = {}
    for (const item of nodes) {
        nodesById[item.id] = item
    }
    return {
        version: 2,
        type,
        previewTemplateDefaultSignature: DEFAULT_SIGNATURE,
        schemaVersion: SCHEMA_VERSION,
        canvas: {
            width: 1000,
            height: 'auto',
            minHeight: 320,
            maxHeight: 1600,
            padding: 24,
            background: {
                type: 'gradient'
            }
        },
        rootId: 'root',
        nodesById,
        childrenByParentId
    }
}

function baseRoot(type) {
    return [
        node('root', 'container', 'root', null, {
            label: `${TYPE_LABELS[type] || type}模板`,
            locked: true,
            layout: { mode: 'flow' },
            style: {}
        }),
        node('typeBadge', 'tag', 'typeBadge', 'root', {
            layout: { mode: 'flow' },
            style: {},
            binding: { source: 'card.typeLabel', fallback: TYPE_LABELS[type] || type, format: 'badgeText' }
        }),
        node('card', 'container', 'card', 'root', {
            locked: true,
            layout: { mode: 'flow' },
            style: {}
        })
    ]
}

function headerNodes(parent = 'content', labels = {}) {
    return [
        node('header', 'container', 'header', parent, {
            layout: { mode: 'flow' },
            style: {}
        }),
        node('avatar', 'image', 'avatar', 'header', {
            layout: { mode: 'flow' },
            style: {},
            binding: { source: labels.avatar || 'author.avatar', format: 'imageUrl' }
        }),
        node('authorName', 'text', 'authorName', 'header', {
            layout: { mode: 'flow' },
            style: {},
            binding: { source: labels.author || 'author.name', fallback: 'Unknown', format: 'plainText' }
        }),
        node('pubTime', 'text', 'pubTime', 'header', {
            layout: { mode: 'flow' },
            style: {},
            binding: { source: labels.time || 'time.pubText', fallback: '', format: 'plainText' }
        })
    ]
}

function coverNode(source, options = {}) {
    return node('cover', 'image', 'cover', 'card', {
        layout: { mode: 'flow', ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}) },
        style: {},
        binding: { source, format: 'imageUrl' },
        hideWhenEmpty: true
    })
}

function contentNode() {
    return node('content', 'container', 'content', 'card', {
        layout: { mode: 'flow' },
        style: {}
    })
}

function titleNode(source) {
    return node('title', 'text', 'title', 'content', {
        layout: { mode: 'flow' },
        style: {},
        binding: { source, fallback: '标题', format: 'plainText' }
    })
}

function textNode(id, role, source, label = null) {
    return node(id, 'text', role, 'content', {
        label: label || ROLE_LABELS[role] || id,
        layout: { mode: 'flow' },
        style: {},
        binding: { source, fallback: '', format: 'plainText' },
        hideWhenEmpty: true
    })
}

function statsNode(parent = 'content', items = ['views', 'likes', 'comments']) {
    return node('stats', 'stats', 'stats', parent, {
        items,
        layout: { mode: 'flow' },
        style: {}
    })
}

function buildVideoTemplate() {
    const nodes = [
        ...baseRoot('video'),
        coverNode('video.cover'),
        contentNode(),
        ...headerNodes(),
        titleNode('video.title'),
        statsNode(),
        textNode('text', 'text', 'video.desc', '简介')
    ]
    return buildTemplate('video', nodes, {
        root: ['typeBadge', 'card'],
        card: ['cover', 'content'],
        content: ['header', 'title', 'stats', 'text'],
        header: ['avatar', 'authorName', 'pubTime']
    })
}

function buildLiveTemplate() {
    const nodes = [
        ...baseRoot('live'),
        coverNode('live.cover'),
        contentNode(),
        ...headerNodes('content', { author: 'author.name' }),
        node('liveBadge', 'tag', 'liveBadge', 'header', {
            layout: { mode: 'flow' },
            style: {},
            binding: { source: 'live.statusText', fallback: 'LIVE', format: 'badgeText' }
        }),
        node('roomId', 'text', 'roomId', 'header', {
            layout: { mode: 'flow' },
            style: {},
            binding: { source: 'live.roomId', fallback: '', format: 'plainText' }
        }),
        titleNode('live.title'),
        statsNode()
    ].filter(item => item.id !== 'pubTime')
    return buildTemplate('live', nodes, {
        root: ['typeBadge', 'card'],
        card: ['cover', 'content'],
        content: ['header', 'title', 'stats'],
        header: ['avatar', 'authorName', 'liveBadge', 'roomId']
    })
}

function buildBangumiTemplate() {
    const nodes = [
        ...baseRoot('bangumi'),
        coverNode('bangumi.cover', { aspectRatio: '3 / 4' }),
        contentNode(),
        titleNode('bangumi.title'),
        node('statusLine', 'text', 'statusLine', 'content', {
            layout: { mode: 'flow' },
            style: {},
            binding: { source: 'bangumi.statusLine', fallback: '', format: 'plainText' }
        }),
        statsNode(),
        textNode('text', 'text', 'bangumi.progress', '简介')
    ]
    return buildTemplate('bangumi', nodes, {
        root: ['typeBadge', 'card'],
        card: ['cover', 'content'],
        content: ['title', 'statusLine', 'stats', 'text']
    })
}

function buildArticleTemplate() {
    const nodes = [
        ...baseRoot('article'),
        contentNode(),
        ...headerNodes(),
        node('decorationCard', 'shape', 'decorationCard', 'content', {
            visible: false,
            layout: { mode: 'flow' },
            style: {}
        }),
        coverNode('article.cover'),
        titleNode('article.title'),
        textNode('text', 'text', 'article.summary', '摘要'),
        statsNode()
    ]
    nodes.find(item => item.id === 'cover').parentId = 'content'
    return buildTemplate('article', nodes, {
        root: ['typeBadge', 'card'],
        card: ['content'],
        content: ['header', 'decorationCard', 'cover', 'title', 'text', 'stats'],
        header: ['avatar', 'authorName', 'pubTime']
    })
}

function buildDynamicTemplate() {
    const nodes = [
        ...baseRoot('dynamic'),
        contentNode(),
        ...headerNodes(),
        node('decorationCard', 'shape', 'decorationCard', 'content', {
            visible: false,
            layout: { mode: 'flow' },
            style: {}
        }),
        titleNode('dynamic.title'),
        textNode('text', 'text', 'dynamic.text', '正文'),
        node('media', 'image', 'media', 'content', {
            layout: { mode: 'flow' },
            style: {},
            binding: { source: 'dynamic.media', format: 'imageUrl' },
            hideWhenEmpty: true
        }),
        textNode('embeddedResource', 'embeddedResource', 'dynamic.embeddedTitle', '引用资源'),
        textNode('supplementalCards', 'supplementalCards', 'dynamic.embeddedTitle', '补充卡片'),
        textNode('origCard', 'origCard', 'dynamic.origText', '转发卡片'),
        statsNode()
    ]
    return buildTemplate('dynamic', nodes, {
        root: ['typeBadge', 'card'],
        card: ['content'],
        content: ['header', 'decorationCard', 'title', 'text', 'media', 'embeddedResource', 'supplementalCards', 'origCard', 'stats'],
        header: ['avatar', 'authorName', 'pubTime']
    })
}

function buildUserTemplate() {
    const nodes = [
        ...baseRoot('user'),
        contentNode(),
        ...headerNodes('content', { author: 'user.name', avatar: 'user.avatar' }),
        node('uid', 'text', 'uid', 'header', {
            layout: { mode: 'flow' },
            style: {},
            binding: { source: 'user.uid', fallback: '', format: 'plainText' },
            hideWhenEmpty: true
        }),
        node('medal', 'tag', 'medal', 'content', {
            visible: false,
            layout: { mode: 'flow' },
            style: {},
            binding: { source: 'static', value: '粉丝牌', format: 'badgeText' }
        }),
        textNode('signature', 'signature', 'user.signature', '签名'),
        statsNode(),
        node('dynamicSection', 'container', 'dynamicSection', 'content', {
            label: '最近动态',
            layout: { mode: 'flow' },
            style: {}
        }),
        node('dynamicText', 'text', 'dynamicText', 'dynamicSection', {
            layout: { mode: 'flow' },
            style: {},
            binding: { source: 'user.recentDynamicText', fallback: '', format: 'plainText' },
            hideWhenEmpty: true
        }),
        node('dynamicMedia', 'image', 'dynamicMedia', 'dynamicSection', {
            layout: { mode: 'flow' },
            style: {},
            binding: { source: 'dynamic.media', format: 'imageUrl' },
            hideWhenEmpty: true
        }),
        textNode('supplementalCards', 'supplementalCards', 'dynamic.embeddedTitle', '补充卡片')
    ].filter(item => item.id !== 'pubTime')
    nodes.find(item => item.id === 'supplementalCards').parentId = 'dynamicSection'
    return buildTemplate('user', nodes, {
        root: ['typeBadge', 'card'],
        card: ['content'],
        content: ['header', 'medal', 'signature', 'stats', 'dynamicSection'],
        header: ['avatar', 'authorName', 'uid'],
        dynamicSection: ['dynamicText', 'dynamicMedia', 'supplementalCards']
    })
}

const BUILDERS = {
    video: buildVideoTemplate,
    live: buildLiveTemplate,
    bangumi: buildBangumiTemplate,
    article: buildArticleTemplate,
    dynamic: buildDynamicTemplate,
    user: buildUserTemplate
}

function getDefaultTemplate(type = 'video') {
    const builder = BUILDERS[type] || BUILDERS.video
    return clone(builder())
}

function getAllDefaultTemplates() {
    return Object.fromEntries(CARD_TYPES.map(type => [type, getDefaultTemplate(type)]))
}

module.exports = {
    getDefaultTemplate,
    getAllDefaultTemplates,
    getDefaultTemplates: getAllDefaultTemplates
}
