'use strict'

const PREVIEW_TEMPLATE_VERSION = 2

const CARD_TYPES = ['video', 'dynamic', 'article', 'live', 'bangumi', 'user']

const LIMITS = {
    jsonBytes: 128 * 1024,
    nodes: 80,
    depth: 5,
    textLength: 400,
    nodeId: /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/,
    canvas: {
        width: { min: 640, max: 1400 },
        minHeight: { min: 160, max: 1600 },
        maxHeight: { min: 240, max: 2400 }
    },
    layout: {
        x: { min: -1200, max: 2400 },
        y: { min: -1200, max: 2400 },
        width: { min: 20, max: 1400 },
        height: { min: 20, max: 2400 },
        marginTop: { min: -240, max: 360 },
        marginBottom: { min: -240, max: 360 },
        padding: { min: 0, max: 120 },
        gap: { min: 0, max: 120 },
        zIndex: { min: -20, max: 200, integer: true },
        columns: { min: 1, max: 6, integer: true }
    },
    style: {
        fontSize: { min: 10, max: 96 },
        fontWeight: { min: 100, max: 900, integer: true },
        lineHeight: { min: 0.8, max: 2.8 },
        maxLines: { min: 1, max: 40, integer: true },
        maxHeight: { min: 20, max: 2400 },
        radius: { min: 0, max: 80 },
        opacity: { min: 0, max: 1 },
        borderWidth: { min: 0, max: 12 }
    }
}

const NODE_TYPES = {
    container: { label: '容器', allowsChildren: true },
    element: { label: '业务元素', allowsChildren: false },
    tag: { label: '标签', allowsChildren: false },
    text: { label: '文本', allowsChildren: false },
    image: { label: '图片', allowsChildren: false },
    stats: { label: '统计栏', allowsChildren: false },
    shape: { label: '形状', allowsChildren: false }
}

const LAYOUT_MODES = ['flow', 'absolute', 'stack', 'flex', 'grid']
const DIRECTIONS = ['row', 'column']
const ALIGN_VALUES = ['start', 'center', 'end', 'stretch']
const JUSTIFY_VALUES = ['start', 'center', 'end', 'space-between', 'space-around']
const OBJECT_FIT_VALUES = ['cover', 'contain', 'fill']
const OBJECT_POSITION_VALUES = ['top', 'center', 'bottom', '50% 50%']
const SHADOW_VALUES = ['none', 'soft', 'medium']
const FORMAT_VALUES = ['plainText', 'numberCompact', 'dateText', 'duration', 'imageUrl', 'badgeText']

const SAFE_BINDINGS = {
    common: [
        'static',
        'card.type',
        'card.typeLabel',
        'card.url',
        'card.id',
        'card.placeholderImage',
        'author.name',
        'author.avatar',
        'author.uid',
        'author.verifyType',
        'time.pubText',
        'stats.views',
        'stats.likes',
        'stats.comments',
        'stats.shares'
    ],
    video: ['video.title', 'video.cover', 'video.desc', 'video.duration'],
    dynamic: ['dynamic.title', 'dynamic.text', 'dynamic.media', 'dynamic.embeddedTitle', 'dynamic.origText'],
    article: ['article.title', 'article.cover', 'article.summary', 'article.bodyPreview'],
    live: ['live.title', 'live.cover', 'live.roomId', 'live.statusText'],
    bangumi: ['bangumi.title', 'bangumi.cover', 'bangumi.progress', 'bangumi.statusLine'],
    user: ['user.name', 'user.avatar', 'user.signature', 'user.uid', 'user.recentDynamicText', 'dynamic.media', 'dynamic.embeddedTitle']
}

const TYPE_LABELS = {
    video: '视频',
    dynamic: '动态',
    article: '专栏',
    live: '直播',
    bangumi: '番剧',
    user: '用户'
}

const TYPE_ROLES = {
    video: ['typeBadge', 'card', 'cover', 'content', 'header', 'avatar', 'authorName', 'pubTime', 'title', 'stats', 'text'],
    dynamic: ['typeBadge', 'card', 'content', 'header', 'avatar', 'authorName', 'pubTime', 'decorationCard', 'title', 'text', 'media', 'embeddedResource', 'supplementalCards', 'origCard', 'stats'],
    article: ['typeBadge', 'card', 'content', 'header', 'avatar', 'authorName', 'pubTime', 'decorationCard', 'cover', 'title', 'text', 'stats'],
    live: ['typeBadge', 'card', 'cover', 'content', 'header', 'avatar', 'authorName', 'roomId', 'liveBadge', 'title', 'stats'],
    bangumi: ['typeBadge', 'card', 'cover', 'content', 'title', 'statusLine', 'stats', 'text'],
    user: ['typeBadge', 'card', 'content', 'header', 'avatar', 'authorName', 'uid', 'medal', 'signature', 'stats', 'dynamicSection', 'dynamicText', 'dynamicMedia', 'supplementalCards']
}

const ROOT_ROLE = 'root'
const CORE_ROLE_SET_BY_TYPE = Object.fromEntries(Object.entries(TYPE_ROLES).map(([type, roles]) => [
    type,
    new Set([ROOT_ROLE, ...roles])
]))

const REQUIRED_ROLES = {
    video: ['root', 'typeBadge', 'card', 'cover', 'content', 'header', 'avatar', 'authorName', 'pubTime', 'title', 'stats'],
    dynamic: ['root', 'typeBadge', 'card', 'content', 'header', 'avatar', 'authorName', 'pubTime', 'text', 'stats'],
    article: ['root', 'typeBadge', 'card', 'content', 'header', 'avatar', 'authorName', 'pubTime', 'title', 'stats'],
    live: ['root', 'typeBadge', 'card', 'cover', 'content', 'header', 'avatar', 'authorName', 'liveBadge', 'roomId', 'title', 'stats'],
    bangumi: ['root', 'typeBadge', 'card', 'cover', 'content', 'title', 'statusLine', 'stats'],
    user: ['root', 'typeBadge', 'card', 'content', 'header', 'avatar', 'authorName', 'stats']
}

const GENERIC_INSERT_PARENTS = {
    video: ['content', 'card'],
    dynamic: ['content', 'card'],
    article: ['content', 'card'],
    live: ['content', 'card'],
    bangumi: ['content', 'card'],
    user: ['content', 'dynamicSection', 'card']
}

function createRolePolicy(type) {
    const roles = TYPE_ROLES[type] || []
    const required = new Set(REQUIRED_ROLES[type] || [])
    const allowedParentByRole = {}
    const defaultTemplateParents = {
        typeBadge: 'root',
        card: 'root',
        cover: ['card', 'content'],
        content: 'card',
        header: 'content',
        avatar: 'header',
        authorName: 'header',
        pubTime: 'header',
        title: 'content',
        text: 'content',
        stats: 'content',
        decorationCard: 'content',
        media: 'content',
        embeddedResource: 'content',
        supplementalCards: type === 'user' ? ['content', 'dynamicSection'] : 'content',
        origCard: 'content',
        roomId: 'header',
        liveBadge: 'header',
        statusLine: 'content',
        uid: 'header',
        medal: 'content',
        signature: 'content',
        dynamicSection: 'content',
        dynamicText: 'dynamicSection',
        dynamicMedia: 'dynamicSection'
    }
    for (const role of roles) {
        allowedParentByRole[role] = defaultTemplateParents[role] || 'content'
    }
    return {
        requiredRoles: Array.from(required),
        optionalRoles: roles.filter(role => !required.has(role)),
        allowedParentByRole,
        genericInsertParents: GENERIC_INSERT_PARENTS[type] || ['content'],
        layoutPolicy: {
            coreAllowedModes: ['flow', 'stack', 'flex', 'grid'],
            genericAllowedModes: LAYOUT_MODES,
            transformRoles: ['typeBadge', 'card', 'cover', 'content', 'header', 'avatar', 'authorName', 'pubTime', 'title', 'text', 'stats', 'liveBadge', 'statusLine', 'media', 'origCard', 'embeddedResource', 'supplementalCards', 'dynamicSection'],
            resizableRoles: ['card', 'cover', 'content', 'text', 'title', 'media', 'dynamicMedia', 'dynamicSection']
        },
        stylePolicy: {
            coreFields: ['fontSize', 'fontWeight', 'lineHeight', 'maxLines', 'maxHeight', 'color', 'opacity', 'objectFit', 'objectPosition'],
            genericFields: ['fontSize', 'fontWeight', 'lineHeight', 'maxLines', 'maxHeight', 'radius', 'opacity', 'borderWidth', 'color', 'background', 'borderColor', 'objectFit', 'objectPosition', 'shadow']
        },
        bindingPolicy: {}
    }
}

const ROLE_POLICIES = Object.fromEntries(CARD_TYPES.map(type => [type, createRolePolicy(type)]))

const ROLE_LABELS = {
    typeBadge: '类型标签',
    card: '卡片',
    cover: '封面',
    content: '内容区',
    header: '作者栏',
    avatar: '头像',
    authorName: '名称',
    pubTime: '发布时间',
    title: '标题',
    stats: '统计栏',
    text: '正文',
    decorationCard: '装扮卡',
    media: '媒体区',
    embeddedResource: '引用资源',
    supplementalCards: '补充卡片',
    origCard: '转发卡片',
    roomId: '房间号',
    liveBadge: '直播状态',
    statusLine: '状态行',
    uid: 'UID',
    medal: '粉丝牌',
    signature: '签名',
    dynamicSection: '最近动态',
    dynamicText: '动态正文',
    dynamicMedia: '动态媒体'
}

const COMPONENT_REGISTRY = {
    container: {
        label: '容器',
        type: 'container',
        allowsChildren: true,
        allowAbsolute: true,
        defaultNode: {
            type: 'container',
            label: '容器',
            layout: { mode: 'stack', gap: 8, padding: 8 },
            style: { background: 'transparent', radius: 0 }
        }
    },
    staticText: {
        label: '静态文本',
        type: 'text',
        allowsChildren: false,
        allowAbsolute: true,
        defaultNode: {
            type: 'text',
            label: '静态文本',
            binding: { source: 'static', value: '自定义文本', format: 'plainText' },
            layout: { mode: 'flow' },
            style: { fontSize: 24, lineHeight: 1.3, color: '#1F2937' }
        }
    },
    boundText: {
        label: '绑定文本',
        type: 'text',
        allowsChildren: false,
        allowAbsolute: true,
        defaultNode: {
            type: 'text',
            label: '绑定文本',
            binding: { source: 'card.typeLabel', fallback: '', format: 'plainText' },
            layout: { mode: 'flow' },
            style: { fontSize: 22, lineHeight: 1.3, color: '#4B5563' }
        }
    },
    tag: {
        label: '标签',
        type: 'tag',
        allowsChildren: false,
        allowAbsolute: true,
        defaultNode: {
            type: 'tag',
            label: '标签',
            binding: { source: 'static', value: '标签', format: 'badgeText' },
            layout: { mode: 'absolute', x: 24, y: 24, width: 120, height: 40, zIndex: 20 },
            style: { background: '#F85B8F', color: '#FFFFFF', radius: 14, fontSize: 18, fontWeight: 700 }
        }
    },
    imagePlaceholder: {
        label: '图片占位',
        type: 'image',
        allowsChildren: false,
        allowAbsolute: true,
        defaultNode: {
            type: 'image',
            label: '图片占位',
            binding: { source: 'card.placeholderImage', format: 'imageUrl' },
            layout: { mode: 'flow', width: 240, height: 135 },
            style: { objectFit: 'cover', objectPosition: '50% 50%', radius: 16 }
        }
    },
    stats: {
        label: '统计栏',
        type: 'stats',
        allowsChildren: false,
        allowAbsolute: true,
        defaultNode: {
            type: 'stats',
            label: '统计栏',
            items: ['views', 'likes', 'comments'],
            layout: { mode: 'flex', direction: 'row', gap: 12 },
            style: { fontSize: 18, color: '#6B7280' }
        }
    },
    shape: {
        label: '形状',
        type: 'shape',
        allowsChildren: false,
        allowAbsolute: true,
        defaultNode: {
            type: 'shape',
            label: '形状',
            layout: { mode: 'absolute', x: 32, y: 32, width: 120, height: 80, zIndex: 1 },
            style: { background: '#FFFFFF', radius: 16, opacity: 0.72, shadow: 'soft' }
        }
    }
}

function clone(value) {
    return JSON.parse(JSON.stringify(value))
}

function getPreviewTemplateSchema() {
    const types = {}
    for (const type of CARD_TYPES) {
        types[type] = {
            label: TYPE_LABELS[type],
            status: 'editable',
            roles: TYPE_ROLES[type].map(role => ({
                role,
                label: ROLE_LABELS[role] || role
            }))
        }
    }
    return {
        version: PREVIEW_TEMPLATE_VERSION,
        types,
        roles: clone(TYPE_ROLES),
        nodeTypes: clone(NODE_TYPES),
        componentRegistry: clone(COMPONENT_REGISTRY),
        rolePolicies: clone(ROLE_POLICIES),
        bindings: clone(SAFE_BINDINGS),
        bindingSources: Array.from(CARD_TYPES.reduce((set, type) => {
            for (const b of getAllowedBindings(type)) set.add(b)
            return set
        }, new Set())),
        bindingFormats: clone(FORMAT_VALUES),
        controls: {
            layoutModes: clone(LAYOUT_MODES),
            directions: clone(DIRECTIONS),
            align: clone(ALIGN_VALUES),
            justify: clone(JUSTIFY_VALUES),
            objectFit: clone(OBJECT_FIT_VALUES),
            objectPosition: clone(OBJECT_POSITION_VALUES),
            shadow: clone(SHADOW_VALUES),
            formats: clone(FORMAT_VALUES)
        },
        limits: clone(LIMITS)
    }
}

function isEditableType(type) {
    return CARD_TYPES.includes(String(type || ''))
}

function getAllowedBindings(type) {
    return new Set([...(SAFE_BINDINGS.common || []), ...(SAFE_BINDINGS[type] || [])])
}

function getComponentRegistry() {
    return clone(COMPONENT_REGISTRY)
}

function isLegacyRole(type, role) {
    return Boolean(role && CORE_ROLE_SET_BY_TYPE[type]?.has(role))
}

function getRolePolicy(type) {
    return clone(ROLE_POLICIES[type] || createRolePolicy(type))
}

module.exports = {
    PREVIEW_TEMPLATE_VERSION,
    CARD_TYPES,
    LIMITS,
    NODE_TYPES,
    LAYOUT_MODES,
    DIRECTIONS,
    ALIGN_VALUES,
    JUSTIFY_VALUES,
    OBJECT_FIT_VALUES,
    OBJECT_POSITION_VALUES,
    SHADOW_VALUES,
    FORMAT_VALUES,
    SAFE_BINDINGS,
    TYPE_LABELS,
    TYPE_ROLES,
    ROLE_LABELS,
    COMPONENT_REGISTRY,
    ROLE_POLICIES,
    getPreviewTemplateSchema,
    isEditableType,
    getAllowedBindings,
    getComponentRegistry,
    isLegacyRole,
    getRolePolicy
}
