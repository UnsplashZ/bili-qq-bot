'use strict'

const PREVIEW_LAYOUT_VERSION = 1

const LIMITS = {
    jsonBytes: 64 * 1024,
    layout: {
        offsetX: { min: -120, max: 120 },
        offsetY: { min: -120, max: 120 },
        width: { min: 80, max: 1200 },
        height: { min: 40, max: 1600 },
        marginTop: { min: -80, max: 160 },
        marginBottom: { min: -80, max: 160 }
    },
    typography: {
        fontSize: { min: 12, max: 72 },
        lineHeight: { min: 1.0, max: 2.4 },
        maxLines: { min: 1, max: 30, integer: true },
        maxHeight: { min: 40, max: 2400 }
    },
    media: {
        borderRadius: { min: 0, max: 32 },
        aspectRatio: ['16/9', '21/9', '4/3', '1/1', '3/4'],
        objectFit: ['cover', 'contain', 'fill'],
        objectPosition: ['top', 'center', 'bottom']
    }
}

const FIELD_GROUPS = {
    layout: {
        mode: { kind: 'enum', values: ['flow'] },
        offsetX: { kind: 'number', limit: LIMITS.layout.offsetX },
        offsetY: { kind: 'number', limit: LIMITS.layout.offsetY },
        width: { kind: 'number', limit: LIMITS.layout.width },
        height: { kind: 'number', limit: LIMITS.layout.height },
        marginTop: { kind: 'number', limit: LIMITS.layout.marginTop },
        marginBottom: { kind: 'number', limit: LIMITS.layout.marginBottom }
    },
    typography: {
        fontSize: { kind: 'number', limit: LIMITS.typography.fontSize },
        lineHeight: { kind: 'number', limit: LIMITS.typography.lineHeight },
        maxLines: { kind: 'number', limit: LIMITS.typography.maxLines },
        maxHeight: { kind: 'number', limit: LIMITS.typography.maxHeight }
    },
    media: {
        aspectRatio: { kind: 'enum', values: LIMITS.media.aspectRatio },
        objectFit: { kind: 'enum', values: LIMITS.media.objectFit },
        objectPosition: { kind: 'enum', values: LIMITS.media.objectPosition },
        borderRadius: { kind: 'number', limit: LIMITS.media.borderRadius }
    }
}

const VIDEO_ELEMENTS = {
    typeBadge: {
        label: '类型标签',
        controls: ['visible', 'layout', 'typography']
    },
    card: {
        label: '卡片',
        controls: ['layout']
    },
    cover: {
        label: '封面',
        controls: ['visible', 'layout', 'media']
    },
    content: {
        label: '内容区',
        controls: ['visible', 'layout']
    },
    header: {
        label: '作者栏',
        controls: ['visible', 'layout']
    },
    avatar: {
        label: '头像',
        controls: ['visible', 'layout', 'media']
    },
    authorName: {
        label: 'UP 名称',
        controls: ['visible', 'layout', 'typography']
    },
    pubTime: {
        label: '发布时间',
        controls: ['visible', 'layout', 'typography']
    },
    title: {
        label: '标题',
        controls: ['visible', 'layout', 'typography']
    },
    stats: {
        label: '统计栏',
        controls: ['visible', 'layout', 'typography']
    },
    text: {
        label: '简介',
        controls: ['visible', 'layout', 'typography']
    }
}

const TYPES = {
    video: {
        label: '视频',
        status: 'editable',
        elements: VIDEO_ELEMENTS
    },
    dynamic: {
        label: '动态',
        status: 'planned',
        elements: {}
    },
    article: {
        label: '专栏',
        status: 'planned',
        elements: {}
    },
    live: {
        label: '直播',
        status: 'planned',
        elements: {}
    },
    bangumi: {
        label: '番剧',
        status: 'planned',
        elements: {}
    },
    user: {
        label: '用户',
        status: 'planned',
        elements: {}
    }
}

function getPreviewLayoutSchema() {
    return {
        version: PREVIEW_LAYOUT_VERSION,
        types: JSON.parse(JSON.stringify(TYPES)),
        limits: JSON.parse(JSON.stringify(LIMITS)),
        fieldGroups: JSON.parse(JSON.stringify(FIELD_GROUPS))
    }
}

function getTypeSchema(type) {
    return TYPES[String(type || '')] || null
}

function isEditableType(type) {
    return getTypeSchema(type)?.status === 'editable'
}

function getElementSchema(type, elementKey) {
    const typeSchema = getTypeSchema(type)
    if (!typeSchema) return null
    return typeSchema.elements[String(elementKey || '')] || null
}

function getEditableElementKeys(type) {
    const typeSchema = getTypeSchema(type)
    if (!typeSchema) return []
    return Object.keys(typeSchema.elements || {})
}

module.exports = {
    PREVIEW_LAYOUT_VERSION,
    LIMITS,
    FIELD_GROUPS,
    getPreviewLayoutSchema,
    getTypeSchema,
    isEditableType,
    getElementSchema,
    getEditableElementKeys
}
