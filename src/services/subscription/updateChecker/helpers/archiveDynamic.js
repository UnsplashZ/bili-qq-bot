function getArchiveDynamicContext(item) {
    const modules = item?.modules || {}
    const dynamic = modules.module_dynamic || {}
    const major = dynamic.major || {}
    const archive = major.archive || {}
    const author = modules.module_author || {}

    return {
        itemType: item?.type || '',
        majorType: major.type || '',
        title: String(archive.title || '').trim(),
        pubAction: String(author.pub_action || '').trim()
    }
}

function isArchiveDynamic(item) {
    const { itemType, majorType } = getArchiveDynamicContext(item)
    return majorType === 'MAJOR_TYPE_ARCHIVE' || itemType === 'DYNAMIC_TYPE_AV'
}

function classifyArchiveDynamic(item) {
    if (!isArchiveDynamic(item)) return null

    const { title, pubAction } = getArchiveDynamicContext(item)

    if (pubAction === '发布了动态视频') {
        return 'dynamic_video'
    }

    if (/^动态视频[｜|]/.test(title)) {
        return 'dynamic_video'
    }

    if (pubAction === '投稿了视频') {
        return 'video_auto_post'
    }

    return 'unknown_archive_dynamic'
}

module.exports = {
    classifyArchiveDynamic
}
