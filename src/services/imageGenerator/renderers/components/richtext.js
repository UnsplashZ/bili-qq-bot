/**
 * 富文本解析器
 * 解析 Bilibili 富文本节点 (表情、@用户、话题、投票、URL等)
 */

/**
 * 解析富文本节点数组，返回 HTML 字符串
 * @param {Array} nodes - 富文本节点数组
 * @param {String} rawText - 原始文本 (fallback)
 * @returns {String} HTML 字符串
 */
function parseRichText(nodes, rawText) {
    if (nodes && nodes.length > 0) {
        return nodes.map(node => {
            const type = node.type;
            const text = node.text;
            if (type === 'RICH_TEXT_NODE_TYPE_EMOJI') {
                const icon = node.emoji ? node.emoji.icon_url : '';
                return icon ? `<img class="emoji" src="${icon}" alt="${text}" />` : text;
            } else if (type === 'RICH_TEXT_NODE_TYPE_AT') {
                return `<span class="at-user">${text}</span>`;
            } else if (type === 'RICH_TEXT_NODE_TYPE_TOPIC') {
                return `<span class="topic-tag">${text}</span>`;
            } else if (type === 'RICH_TEXT_NODE_TYPE_VOTE') {
                return `<span class="vote-inline">${text}</span>`;
            } else if (type === 'RICH_TEXT_NODE_TYPE_URL' || type === 'RICH_TEXT_NODE_TYPE_BV') {
                return `<span style="color: var(--color-secondary); text-decoration: none; cursor: pointer;">${text}</span>`;
            } else {
                return text.replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;")
                    .replace(/\n/g, '<br>');
            }
        }).join('');
    }
    return (rawText || '').replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
        .replace(/\n/g, '<br>');
}

module.exports = {
    parseRichText
};
