const fs = require('fs');
const path = require('path');
const logger = require('../../../utils/logger');

// 模块级字体缓存 (不依赖类实例)
let fontCache = null;

/**
 * HTML转义函数
 */
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * 格式化时长 (秒 → HH:MM:SS 或 MM:SS)
 */
function formatDuration(seconds) {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    } else {
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
}

/**
 * 格式化发布时间
 * 支持相对时间和绝对时间
 */
function formatPubTime(timestamp) {
    if (!timestamp) return '';
    const now = new Date();
    const date = new Date(timestamp * 1000);

    // 校验日期是否有效
    if (isNaN(date.getTime())) {
        // 尝试直接解析字符串 (兼容 "YYYY-MM-DD HH:mm:ss" 或其他格式)
        const tryDate = new Date(timestamp);
        if (!isNaN(tryDate.getTime())) {
            // 如果解析出来的时间非常小（例如被误判为1970年附近），说明可能是字符串解析问题
            // 但这里主要处理 "2025年01月11日 12:53" 这种格式，new Date() 可能无法直接处理中文日期
            // 尝试简单的正则替换：年/月/日 -> /
            let cleanStr = String(timestamp).replace(/[年月]/g, '/').replace(/日/g, '');
            const tryDate2 = new Date(cleanStr);
            if (!isNaN(tryDate2.getTime())) {
                return formatPubTime(tryDate2.getTime() / 1000);
            }
            return String(timestamp);
        }
        return String(timestamp);
    }

    const diff = now - date;
    const diffMinutes = Math.floor(diff / 1000 / 60);
    const diffHours = Math.floor(diff / 1000 / 3600);

    // Calculate days based on calendar dates
    const dateZero = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const nowZero = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.floor((nowZero - dateZero) / (1000 * 60 * 60 * 24));

    const isThisYear = now.getFullYear() === date.getFullYear();

    if (!isThisYear) {
        const y = date.getFullYear();
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const d = date.getDate().toString().padStart(2, '0');
        const h = date.getHours().toString().padStart(2, '0');
        const min = date.getMinutes().toString().padStart(2, '0');
        return `${y}年${m}月${d}日 ${h}:${min}`;
    }

    if (diffMinutes < 1) {
        return '刚刚';
    }

    if (diffMinutes < 60) {
        return `${diffMinutes}分钟前`;
    }

    if (diffDays === 0) {
         return `${diffHours}小时前`;
    }

    if (diffDays === 1) {
        const h = date.getHours().toString().padStart(2, '0');
        const min = date.getMinutes().toString().padStart(2, '0');
        return `昨天 ${h}:${min}`;
    }

    if (diffDays === 2) {
         const h = date.getHours().toString().padStart(2, '0');
         const min = date.getMinutes().toString().padStart(2, '0');
         return `前天 ${h}:${min}`;
    }

    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    const h = date.getHours().toString().padStart(2, '0');
    const min = date.getMinutes().toString().padStart(2, '0');
    return `${m}月${d}日 ${h}:${min}`;
}

/**
 * 格式化数字 (转换为万/亿)
 */
function formatNumber(num) {
    if (!num) return '0';
    if (num >= 100000000) {
        return (num / 100000000).toFixed(2) + '亿';
    }
    if (num >= 10000) {
        return (num / 10000).toFixed(1) + '万';
    }
    return num.toString();
}

/**
 * 判断是否为有效的十六进制颜色值
 */
function isHex(c) {
    return typeof c === 'string' && /^#([0-9a-fA-F]{6})$/.test(c);
}

/**
 * 加载自定义字体并缓存
 * 返回 { css: string, families: string[] }
 */
function getCustomFonts() {
    if (fontCache) return fontCache;

    const fontDirs = [
        path.join(__dirname, '../../../fonts/custom')
    ];
    let customFontsCss = '';
    let customFontFamilies = [];

    fontDirs.forEach(fontDir => {
        if (fs.existsSync(fontDir)) {
            try {
                const files = fs.readdirSync(fontDir);
                files.forEach(file => {
                    const ext = path.extname(file).toLowerCase();
                    if (['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) {
                        const fontName = path.basename(file, ext);
                        const fontPath = path.join(fontDir, file);
                        const fontBuffer = fs.readFileSync(fontPath);
                        const base64Font = fontBuffer.toString('base64');

                        const isVariable = /VF|Variable/i.test(fontName);

                        customFontsCss += `
                            @font-face {
                                font-family: "${fontName}";
                                src: url(data:font/${ext.slice(1)};charset=utf-8;base64,${base64Font}) format('${ext === '.ttf' ? 'truetype' : ext === '.otf' ? 'opentype' : ext.slice(1)}');
                                ${isVariable ? 'font-weight: 100 900;' : ''}
                                font-style: normal;
                            }
                        `;
                        customFontFamilies.push(`"${fontName}"`);
                    }
                });
            } catch (e) {
                logger.error(`Failed to load custom fonts from ${fontDir}:`, e);
            }
        }
    });

    fontCache = { css: customFontsCss, families: customFontFamilies };
    return fontCache;
}

module.exports = {
    escapeHtml,
    formatDuration,
    formatPubTime,
    formatNumber,
    isHex,
    getCustomFonts
};
