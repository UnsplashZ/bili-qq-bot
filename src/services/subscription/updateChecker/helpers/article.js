/**
 * 解析专栏推送的实际类型和标题
 * 新版 B 站专栏（cv号）可能被重定向为 opus/动态格式，需按实际类型处理
 * @param {Object} info - biliApi.getArticleInfo 返回值
 * @returns {{ actualType: string, renderType: string, title: string, url: string }}
 */
function resolveArticleTitle(info) {
    const data = info?.data || {}
    const renderType = data.render_type || 'article'
    const actualType = 'article'
    const title = renderType === 'dynamic'
        ? data.render_payload?.data?.item?.modules?.module_dynamic?.major?.opus?.title
        : data.title
    const rawId = data.source_cvid || data.cvid || data.id || ''
    const normalizedId = String(rawId || '').startsWith('cv') ? String(rawId) : (rawId ? `cv${rawId}` : '')
    const url = data.canonical_url || (normalizedId ? `https://www.bilibili.com/read/${normalizedId}` : '')
    return { actualType, renderType, title: title || '（无标题）', url }
}

module.exports = {
    resolveArticleTitle
}
