'use strict'

async function collectPreviewTemplateMetadata(page) {
    return page.evaluate(() => {
        const container = document.querySelector('.container')
        const containerRect = container?.getBoundingClientRect()
        const result = {}
        const toBox = (rect) => ({
            x: rect.left - containerRect.left,
            y: rect.top - containerRect.top,
            width: rect.width,
            height: rect.height
        })
        for (const element of Array.from(document.querySelectorAll('[data-template-node-id]'))) {
            const id = element.getAttribute('data-template-node-id')
            const style = window.getComputedStyle(element)
            const rect = element.getBoundingClientRect()
            const visible = style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity || 1) !== 0 &&
                rect.width > 0 &&
                rect.height > 0
            result[id] = {
                exists: true,
                visible,
                box: visible && containerRect ? toBox(rect) : null,
                className: typeof element.className === 'string' ? element.className : '',
                defaults: {
                    layout: {
                        width: visible ? rect.width : null,
                        height: visible ? rect.height : null
                    },
                    style: {
                        fontSize: Number.parseFloat(style.fontSize) || null,
                        lineHeight: Number.parseFloat(style.lineHeight) || null
                    }
                }
            }
        }
        return {
            container: containerRect ? { width: containerRect.width, height: containerRect.height } : { width: 0, height: 0 },
            elements: result
        }
    })
}

module.exports = {
    collectPreviewTemplateMetadata,
    collectTemplateNodeMetadata: collectPreviewTemplateMetadata
}
