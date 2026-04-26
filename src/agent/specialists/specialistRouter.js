const SPECIALISTS = [
    {
        id: 'bili_agent',
        label: 'B 站查询与订阅 Agent',
        description: '处理 B 站用户、视频、番剧、订阅查询和订阅修改意图。',
        toolPatterns: [/^bili\./, /^subscription\./],
        keywords: [
            /b站|哔哩|bilibili|Bilibili/i,
            /\bBV[0-9A-Za-z]{6,}\b/i,
            /\buid\s*\d{2,}\b/i,
            /订阅|追番|番剧|season|up主|视频|动态/
        ]
    },
    {
        id: 'qq_admin_agent',
        label: 'QQ 群管理 Agent',
        description: '处理 QQ 群信息、成员定位、禁言、撤回、精华、申请、在线状态、Bot/Agent 配置和黑名单意图。',
        toolPatterns: [/^qq\./, /^agent\.(get_group_config|set_group_enabled|set_send_enabled|set_observe_only)$/, /^bot\./, /^blacklist\./],
        keywords: [
            /群|成员|管理员|禁言|解禁|踢|撤回|精华|群名片|全员禁言|加群|好友申请|在线状态|输入状态/,
            /配置|开关|观察模式|发言|黑名单|关闭本群|开启本群|agent/i
        ]
    },
    {
        id: 'memory_agent',
        label: '记忆 Agent',
        description: '处理长期记忆读取、显式学习、记住事实和记忆摘要意图。',
        toolPatterns: [/^agent\.(get_memory_summary|learn_memory)$/],
        keywords: [
            /记住|记一下|记忆|忘记|还记得|以后叫|我喜欢|偏好|关系|是谁/
        ]
    },
    {
        id: 'browser_agent',
        label: '只读浏览器 Agent',
        description: '处理公开网页读取、摘要和来源说明意图；只能使用安全只读网页工具。',
        toolPatterns: [/^browser\./],
        keywords: [
            /https?:\/\/\S+/i,
            /网页|网站|链接|打开|读一下|总结.*页面|摘要.*页面|url/i
        ]
    }
]

function normalizeText(agentMessage = {}) {
    return String(agentMessage.normalizedText || agentMessage.rawText || '')
}

function toolBelongsToSpecialist(toolName, specialist) {
    return specialist.toolPatterns.some((pattern) => pattern.test(toolName))
}

function getSpecialistForTool(toolName) {
    return SPECIALISTS.find((specialist) => toolBelongsToSpecialist(toolName, specialist)) || null
}

function scoreSpecialist(specialist, text) {
    return specialist.keywords.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0)
}

function selectSpecialists({ agentMessage, maxSpecialists = 2 } = {}) {
    const text = normalizeText(agentMessage)
    const scored = SPECIALISTS
        .map((specialist) => ({ specialist, score: scoreSpecialist(specialist, text) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.specialist.id.localeCompare(right.specialist.id))

    const selected = scored.slice(0, maxSpecialists).map((item) => item.specialist)
    return selected.length > 0 ? selected : []
}

function filterToolsForSpecialists(toolDefinitions, specialists) {
    const selectedIds = new Set((Array.isArray(specialists) ? specialists : []).map((specialist) => specialist.id))
    if (selectedIds.size === 0) return toolDefinitions
    return toolDefinitions.filter((tool) => (
        specialists.some((specialist) => toolBelongsToSpecialist(tool.name, specialist))
    ))
}

function buildSpecialistContext({ agentMessage, toolDefinitions } = {}) {
    const specialists = selectSpecialists({ agentMessage })
    const availableTools = filterToolsForSpecialists(toolDefinitions, specialists)
    return {
        mode: specialists.length > 0 ? 'specialist_scoped' : 'general',
        selectedSpecialists: specialists.map((specialist) => ({
            id: specialist.id,
            label: specialist.label,
            description: specialist.description
        })),
        availableToolCount: availableTools.length,
        totalToolCount: Array.isArray(toolDefinitions) ? toolDefinitions.length : 0,
        availableTools
    }
}

module.exports = {
    SPECIALISTS,
    buildSpecialistContext,
    filterToolsForSpecialists,
    getSpecialistForTool,
    selectSpecialists
}
