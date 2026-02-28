const fs = require('fs')
const path = require('path')

function loadSvgDataUri(filename) {
    const filePath = path.resolve(__dirname, '../../assets/icons', filename)
    const svgText = fs.readFileSync(filePath, 'utf8')
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svgText)}`
}

const VERIFY_ICON_URIS = {
    0: loadSvgDataUri('PERSONAL_OFFICIAL_VERIFY.svg'),
    1: loadSvgDataUri('ORGANIZATION_OFFICIAL_VERIFY.svg')
}

function renderVerifyBadge(verifyType, extraClassName = '') {
    const type = Number(verifyType)
    const src = VERIFY_ICON_URIS[type]
    if (!src) return ''
    const className = extraClassName
        ? `author-verify-badge ${extraClassName}`
        : 'author-verify-badge'

    return `
        <span class="${className}" title="用户认证">
            <img class="author-verify-icon" src="${src}" alt="用户认证图标">
        </span>
    `
}

module.exports = {
    renderVerifyBadge
}
