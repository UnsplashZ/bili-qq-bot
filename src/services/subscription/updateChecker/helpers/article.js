/**
 * 解析专栏推送的实际类型和标题
 * 新版 B 站专栏（cv号）可能被重定向为 opus/动态格式，需按实际类型处理
 * @param {Object} info - biliApi.getArticleInfo 返回值
 * @returns {{ actualType: string, title: string }}
 */
function resolveArticleTitle(info) {
    const actualType = info.type || 'article'
    const title = actualType === 'dynamic'
        ? info.data?.item?.modules?.module_dynamic?.major?.opus?.title
        : info.data?.title
    return { actualType, title: title || '（无标题）' }
}

module.exports = {
    resolveArticleTitle
}
