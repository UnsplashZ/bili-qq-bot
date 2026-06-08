'use strict'

const { getEditableElementKeys } = require('./schema')

async function collectPreviewLayoutElementMetadata(page, type = 'video') {
    const elementKeys = getEditableElementKeys(type)

    return page.evaluate((keys) => {
        const numberOrNull = (value) => {
            const number = Number.parseFloat(value)
            return Number.isFinite(number) ? number : null
        }
        const normalizeCssValue = (value) => {
            if (!value || value === 'none' || value === 'auto' || value === 'normal') return null
            return String(value)
        }
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
            const mediaElement = element.matches('img') ? element : element.querySelector('img')
            const mediaStyle = mediaElement ? window.getComputedStyle(mediaElement) : style
            const visible = style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity || 1) !== 0 &&
                rect.width > 0 &&
                rect.height > 0

            result[key] = {
                exists: true,
                visible,
                box: visible && containerRect ? toBox(rect) : null,
                className: typeof element.className === 'string' ? element.className : '',
                defaults: {
                    layout: {
                        width: numberOrNull(rect.width),
                        height: numberOrNull(rect.height),
                        marginTop: numberOrNull(style.marginTop),
                        marginBottom: numberOrNull(style.marginBottom)
                    },
                    typography: {
                        fontSize: numberOrNull(style.fontSize),
                        lineHeight: numberOrNull(style.lineHeight),
                        maxHeight: normalizeCssValue(style.maxHeight),
                        maxLines: normalizeCssValue(style.webkitLineClamp)
                    },
                    media: {
                        aspectRatio: normalizeCssValue(mediaStyle.aspectRatio || style.aspectRatio),
                        objectFit: normalizeCssValue(mediaStyle.objectFit),
                        objectPosition: normalizeCssValue(mediaStyle.objectPosition),
                        borderRadius: normalizeCssValue(mediaStyle.borderRadius || style.borderRadius)
                    }
                }
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
