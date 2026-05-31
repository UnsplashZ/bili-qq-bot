'use strict'

const { getEditableElementKeys } = require('./schema')

async function collectPreviewLayoutElementMetadata(page, type = 'video') {
    const elementKeys = getEditableElementKeys(type)

    return page.evaluate((keys) => {
        const container = document.querySelector('.container')
        const containerRect = container?.getBoundingClientRect()
        const result = {}

        const toBox = (rect) => ({
            x: rect.left - containerRect.left,
            y: rect.top - containerRect.top,
            width: rect.width,
            height: rect.height
        })

        for (const key of keys) {
            const element = document.querySelector(`[data-layout-key="${key}"]`)
            if (!element) {
                result[key] = {
                    exists: false,
                    visible: false,
                    box: null,
                    className: ''
                }
                continue
            }

            const style = window.getComputedStyle(element)
            const rect = element.getBoundingClientRect()
            const visible = style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity || 1) !== 0 &&
                rect.width > 0 &&
                rect.height > 0

            result[key] = {
                exists: true,
                visible,
                box: visible && containerRect ? toBox(rect) : null,
                className: typeof element.className === 'string' ? element.className : ''
            }
        }

        return {
            container: containerRect
                ? { width: containerRect.width, height: containerRect.height }
                : { width: 0, height: 0 },
            elements: result
        }
    }, elementKeys)
}

module.exports = {
    collectPreviewLayoutElementMetadata
}
