function normalizePlainText(text) {
    if (!text) return ''
    return String(text)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\u200b/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

module.exports = {
    normalizePlainText
}
