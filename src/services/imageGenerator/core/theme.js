const config = require('../../../config');
const { generateUnifiedCSS, DESIGN_SYSTEM } = require('../../../utils/designSystem');
const { getCustomFonts } = require('./formatters');

/**
 * 判断是否为夜间模式
 */
function isNightMode(groupId) {
    const nightMode = config.getGroupConfig(groupId, 'nightMode');
    if (!nightMode) return false;
    const { mode, startTime, endTime } = nightMode;

    if (mode === 'on') return true;
    if (mode === 'off') return false;

    // Timed mode
    const now = new Date();
    const shTime = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    }).format(now);

    const [h, m] = shTime.split(':').map(Number);
    const curMinutes = h * 60 + m;

    const [startH, startM] = startTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;

    const [endH, endM] = endTime.split(':').map(Number);
    const endMinutes = endH * 60 + endM;

    if (startMinutes < endMinutes) {
        return curMinutes >= startMinutes && curMinutes < endMinutes;
    } else {
        // Cross midnight, e.g. 21:00 to 06:00
        return curMinutes >= startMinutes || curMinutes < endMinutes;
    }
}

/**
 * 计算视口尺寸
 */
function calculateViewport(type, data) {
    let baseWidth = 1200;
    let minWidth = 400;

    if (type === 'dynamic') {
        const modules = data.data?.item?.modules || data.data?.modules || {};
        const module_dynamic = modules.module_dynamic || {};
        const hasImages = module_dynamic.major?.draw?.items?.length > 0 ||
                        module_dynamic.major?.opus?.pics?.length > 0;
        const hasVideo = !!module_dynamic.major?.archive || !!module_dynamic.major?.live_rcmd;
        const hasOrig = !!(data.data?.item?.orig || data.data?.orig);

        if (hasImages || hasVideo || hasOrig) {
            baseWidth = 1100;
        } else {
            baseWidth = 800;
        }

        // 动态调整宽度以适应长用户名
        const module_author = modules.module_author || {};
        const authorName = module_author.name || '';
        if (authorName.length > 10) {
            // 基础宽度假设只能容纳约10个字符（考虑头像、右侧装饰等占用）
            // 每个额外字符增加约 35px 宽度 (30px 字体 + 间距)
            const extraWidth = (authorName.length - 10) * 35;
            baseWidth += extraWidth;
        }
    } else if (type === 'video' || type === 'live') {
        baseWidth = 1000;
    } else if (type === 'bangumi') {
        baseWidth = 950;
    } else if (type === 'article') {
        baseWidth = 1080;
    } else if (type === 'user') {
        baseWidth = 900;
        const info = data.data || {};
        const name = info.name || '';
        if (name.length > 10) {
            const extraWidth = (name.length - 10) * 40;
            baseWidth += extraWidth;
        }
    }

    return {
        width: baseWidth,
        height: 1200,
        deviceScaleFactor: 1.1,
        minWidth: minWidth
    };
}

/**
 * 获取类型配置 (标签、颜色、图标)
 */
function getTypeConfig(type, data) {
    const TYPE_CONFIG = {
        video: { label: '视频', color: '#FB7299', icon: '▶️' },
        bangumi: { label: '番剧', color: '#00A1D6', icon: '🎬' },
        article: { label: '专栏', color: '#FAA023', icon: '📰' },
        live: { label: '直播', color: '#FF6699', icon: '📡' },
        dynamic: { label: '动态', color: '#00B5E5', icon: '📱' },
        user: { label: '用户', color: '#FB7299', icon: '👤' }
    };
    let currentType = TYPE_CONFIG[type] || { label: 'Bilibili', color: '#FB7299', icon: '' };

    if (type === 'bangumi' && data.data) {
         const seasonType = data.data.season_type;
         if (seasonType === 2) {
             currentType = { label: '电影', color: '#FE5050', icon: '🎬' };
         } else if (seasonType === 3) {
             currentType = { label: '纪录片', color: '#00B5E5', icon: '📽️' };
         } else if (seasonType === 4) {
             currentType = { label: '国创', color: '#00B5E5', icon: '🇨🇳' };
         } else if (seasonType === 5) {
             currentType = { label: '电视剧', color: '#FE5050', icon: '📺' };
         } else if (seasonType === 7) {
             currentType = { label: '综艺', color: '#FE5050', icon: '🎤' };
         }
    }
    return currentType;
}

/**
 * 计算配色方案
 */
function calculateColors(type, data, currentType, isNight) {
    const badgeColor = isNight ? adjustBrightness(currentType.color, -25) : currentType.color;
    const themeClass = isNight ? 'theme-dark' : 'theme-light';

    // Gradient Mix Logic
    const seen = new Set();
    const colors = [];
    const addColor = (c) => {
        if (isHex(c) && !seen.has(c.toLowerCase())) {
            seen.add(c.toLowerCase());
            colors.push(c);
        }
    };

    if (type === 'video' && data.data) {
        const f = (data.data.focus || {});
        addColor(f.cover);
        addColor(f.avatar);
    } else if (type === 'bangumi' && data.data) {
        const f = (data.data.focus || {});
        addColor(f.cover);
    } else if (type === 'article' && data.data) {
        const f = (data.data.focus || {});
        addColor(f.cover);
        addColor(f.avatar);
    } else if (type === 'live' && data.data) {
        const f = (data.data.focus || {});
        addColor(f.cover);
        addColor(f.avatar);
    } else if (type === 'user' && data.data) {
        const f = (data.data.focus || {});
        addColor(f.avatar);
    } else if (type === 'dynamic') {
        let modules = {};
        let item = {};
        if (data.data && data.data.item) {
            item = data.data.item;
            modules = item.modules || {};
        } else if (data.data) {
            item = data.data;
            modules = item.modules || {};
        }
        const module_author = modules.module_author || {};
        const authorInfo = item.author || data.data?.author || {};
        const fanColor = authorInfo.fan_color || (module_author.decoration_card && module_author.decoration_card.fan && module_author.decoration_card.fan.color) || null;
        const cardFocus = authorInfo.card_focus_color || null;
        const avatarFocus = authorInfo.avatar_focus_color || null;
        addColor(fanColor);
        addColor(cardFocus);
        addColor(avatarFocus);
    }

    // 辅助色
    const lightBlue = '#87CEEB';
    const pink = '#FB7299';

    // 颜色补全：0种时用类型默认色，1+种时都添加浅蓝和粉色
    if (colors.length === 0) {
        addColor(currentType.color);
    }
    // 无论提取到几种颜色（1、2或更多），都补全为：基础色 + 浅蓝色 + 粉色
    if (colors.length > 0) {
        addColor(lightBlue);
        addColor(pink);
    }

    // 生成混合渐变效果
    // 核心：基础色线性渐变 + 粉色/浅蓝光斑叠加

    // 通用：粉色光斑（右上）
    const pinkSpots = `radial-gradient(ellipse 80% 60% at 85% 15%, ${hexToRgba(pink, 0.4)} 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 75% 25%, ${hexToRgba(pink, 0.25)} 0%, transparent 50%)`;

    // 通用：浅蓝光斑（左下）
    const blueSpots = `radial-gradient(ellipse 80% 60% at 15% 85%, ${hexToRgba(lightBlue, 0.35)} 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 25% 75%, ${hexToRgba(lightBlue, 0.2)} 0%, transparent 50%)`;

    // 基础色线性渐变（从左上到右下）
    const stops = colors.map((c, i) => `${c} ${Math.round(i * 100 / (colors.length - 1))}%`).join(', ');
    const baseGradient = `linear-gradient(135deg, ${stops})`;

    // 组合所有渐变层
    const gradientMix = `${baseGradient}, ${pinkSpots}, ${blueSpots}`;

    if (isNight) {
        // 深色模式：更浓郁
        return {
            badgeColor,
            themeClass,
            gradientMix,
            badgeBg: '#23272D',
            badgeTextColor: badgeColor,
            badgeShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
            badgeBorder: '1px solid rgba(255, 255, 255, 0.1)',
            currentType
        };
    } else {
        // 浅色模式
        return {
            badgeColor,
            themeClass,
            gradientMix,
            badgeBg: `linear-gradient(135deg, ${badgeColor}, ${adjustBrightness(badgeColor, -10)})`,
            badgeTextColor: '#fff',
            badgeShadow: `0 8px 24px ${hexToRgba(currentType.color, 0.40)}, var(--shadow-sm)`,
            badgeBorder: 'none',
            currentType
        };
    }
}

/**
 * 判断是否为有效的十六进制颜色值
 * (内部辅助函数)
 */
function isHex(c) {
    return typeof c === 'string' && /^#([0-9a-fA-F]{6})$/.test(c);
}

/**
 * 调整颜色亮度
 */
function adjustBrightness(hex, percent) {
    // 移除 # 号
    hex = hex.replace('#', '');

    // 转换为 RGB
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);

    // 调整亮度
    r = Math.max(0, Math.min(255, r + (r * percent / 100)));
    g = Math.max(0, Math.min(255, g + (g * percent / 100)));
    b = Math.max(0, Math.min(255, b + (b * percent / 100)));

    // 转换回 hex
    const rr = Math.round(r).toString(16).padStart(2, '0');
    const gg = Math.round(g).toString(16).padStart(2, '0');
    const bb = Math.round(b).toString(16).padStart(2, '0');

    return `#${rr}${gg}${bb}`;
}

/**
 * 将 hex 颜色转换为 rgba
 */
function hexToRgba(hex, alpha) {
    // 移除 # 号
    hex = hex.replace('#', '');

    // 转换为 RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 生成完整的 CSS 样式
 * 包含统一设计系统 + 自定义样式
 */
function generateCSS(colorData, viewport) {
    // Load Custom Fonts
    const { css: customFontsCss, families: customFontFamilies } = getCustomFonts();

    // Generate Unified CSS from Design System
    const baseCss = generateUnifiedCSS(colorData, viewport, { customFontsCss, customFontFamilies });

    // Append custom styles specific to imageGenerator
    return baseCss + `
        <style>

            .cover-container { position: relative; width: 100%; }
            .cover { width: 100%; display: block; object-fit: cover; border-radius: var(--radius-lg); }
            .cover.video { aspect-ratio: 16/9; }
            .cover.bangumi { aspect-ratio: 3/4; object-fit: cover; }
            .cover.live { aspect-ratio: 16/9; }
            .cover.article { aspect-ratio: 21/9; }

            .content {
                padding: 24px;
                position: relative;
            }

            .header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 20px;
            }

            .header-left { display: flex; align-items: center; }

            .avatar-wrapper {
                position: relative;
                width: 128px;
                height: 128px;
                margin-right: 18px;
                transition: all 0.3s ease-in-out;
            }

            .avatar {
                position: absolute;
                top: 50%;
                left: 50%;
                width: 72px;
                height: 72px;
                transform: translate(-50%, -50%);
                border-radius: 50%;
                border: 3px solid var(--color-card-bg);
                box-shadow: var(--shadow-sm);
                z-index: 1;
                transition: all 0.3s ease-in-out;
            }

            .avatar.no-frame {
                width: 96px;
                height: 96px;
            }

            .avatar.no-border { border: none; }

            .avatar-frame {
                position: absolute;
                top: 50%;
                left: 50%;
                width: 128px;
                height: 128px;
                transform: translate(-50%, -50%);
                object-fit: contain;
                pointer-events: none;
                z-index: 2;
                filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.1));
                transition: all 0.3s ease-in-out;
            }

            .user-info {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .user-name {
                font-size: 30px;
                font-weight: 700;
                color: var(--color-text);
                display: flex;
                align-items: center;
                gap: 10px;
                letter-spacing: 0.3px;
                white-space: nowrap;
            }

            .user-level {
                color: #fff;
                font-size: 16px;
                padding: 2px 8px;
                border-radius: var(--radius-md);
                font-weight: 700;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                background-color: #bfbfbf;
            }
            .user-level.lv0, .user-level.lv1 { background-color: #bfbfbf; }
            .user-level.lv2 { background-color: #95ddb2; }
            .user-level.lv3 { background-color: #92d1e5; }
            .user-level.lv4 { background-color: #ffb37c; }
            .user-level.lv5 { background-color: #ff6c00; }
            .user-level.lv6 { background-color: #ff0000; }
            .user-level.lv7, .user-level.lv8, .user-level.lv9 {
                background: linear-gradient(135deg, #ff0000, #ffb300, #ffff00, #00ff00, #00ffff, #0000ff, #8b00ff);
            }

            .pub-time {
                font-size: 20px;
                color: var(--color-subtext);
                font-weight: 400;
            }

            .decoration-card-wrapper {
                position: relative;
                display: inline-block;
            }

            .decoration-card {
                height: 108px;
                width: auto;
                object-fit: contain;
                margin: 0;
                filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.1));
            }

            .serial-badge {
                position: absolute;
                top: 50%;
                left: 120px;
                transform: translateY(-50%);
                font-weight: 700;
                font-size: 20px;
            }


            .decorate-bg {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 160px;
                border-radius: var(--radius-lg) var(--radius-lg) 0 0;
                overflow: hidden;
            }

            .decorate-bg img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                filter: blur(3px);
                transform: scale(1.1);
            }

            .decorate-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 160px;
                border-radius: var(--radius-lg) var(--radius-lg) 0 0;
                background: linear-gradient(to bottom, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0));
            }

            .title {
                font-size: 42px;
                font-weight: 700;
                margin-bottom: 16px;
                color: var(--color-text);
                line-height: 1.5;
                letter-spacing: 0.5px;
            }
            .status-line {
                margin-top: 8px;
                margin-bottom: 12px;
                font-size: 22px;
                color: var(--color-subtext);
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .status-prefix { white-space: nowrap; }
            .status-meta { white-space: nowrap; }

            .text-content {
                font-size: 30px;
                color: var(--color-text);
                line-height: 1.75;
                margin-top: 20px;
                margin-bottom: 18px;
                white-space: pre-wrap;
                word-wrap: break-word;
                text-align: left;
                max-height: 2500px;
                overflow: hidden;
                position: relative;
            }
            .text-content img {
                max-width: 100%;
                height: auto;
                border-radius: var(--radius-sm);
            }
            .text-content.truncated::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 160px;
                background: linear-gradient(to bottom, transparent, var(--color-card-bg));
                pointer-events: none;
            }

            /* Article Mode Specifics */
            .container.article-mode .card {
                max-width: 960px;
                margin: 0 auto;
            }

            .article-body {
                font-size: 30px;
                color: var(--color-text);
                line-height: 1.8;
                margin-top: 24px;
                margin-bottom: 24px;
                word-wrap: break-word;
                text-align: left;
                max-height: 3000px;
                overflow: hidden;
                position: relative;
            }
            .article-body.truncated::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 160px;
                background: linear-gradient(to bottom, transparent, var(--color-card-bg));
                pointer-events: none;
            }
            .article-body img {
                max-width: 100%;
                height: auto;
                border-radius: var(--radius-md);
                margin: 20px 0;
                display: block;
                box-shadow: var(--shadow-sm);
            }
            .article-body p {
                margin-bottom: 24px;
            }
            .article-body h1 {
                font-size: 1.6em;
                font-weight: 700;
                margin: 40px 0 24px;
                line-height: 1.3;
                border-bottom: 2px solid var(--color-border);
                padding-bottom: 16px;
            }
            .article-body h2 {
                font-size: 1.4em;
                font-weight: 700;
                margin: 36px 0 20px;
                line-height: 1.3;
                border-left: 6px solid var(--color-primary);
                padding-left: 16px;
            }
            .article-body h3 {
                font-size: 1.25em;
                font-weight: 700;
                margin: 28px 0 16px;
            }
            .article-body blockquote {
                background: var(--color-soft-bg);
                border-left: 6px solid var(--color-subtext);
                margin: 24px 0;
                padding: 20px 24px;
                color: var(--color-subtext);
                border-radius: var(--radius-sm);
            }
            .article-body pre {
                background: var(--color-soft-bg-2);
                padding: 20px;
                border-radius: var(--radius-md);
                overflow-x: auto;
                font-family: monospace;
                margin: 24px 0;
                font-size: 0.9em;
            }
            .article-body ul, .article-body ol {
                padding-left: 40px;
                margin-bottom: 24px;
            }
            .article-body li {
                margin-bottom: 12px;
            }
            .article-body a {
                color: var(--color-secondary);
                text-decoration: none;
                border-bottom: 1px dashed var(--color-secondary);
            }
            /* Bilibili specific cleanups */
            .article-body .cut-off-5 { display: none; }
            .article-body .img-caption {
                font-size: 24px;
                color: var(--color-subtext);
                text-align: center;
                margin-top: -10px;
                margin-bottom: 24px;
            }

            .orig-card {
                margin-top: 16px;
                border: 2px solid var(--color-border);
                background: var(--color-card-bg);
                border-radius: var(--radius-lg);
                overflow: hidden;
                box-shadow: var(--shadow-sm);
            }

            .orig-header {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 16px;
                border-bottom: 2px solid var(--color-border);
                background: var(--color-soft-bg);
            }

            .orig-author-avatar {
                width: 48px;
                height: 48px;
                border-radius: 50%;
                box-shadow: var(--shadow-sm);
            }

            .orig-author-name {
                font-weight: 700;
                font-size: 20px;
                color: var(--color-text);
            }

            .orig-content { padding: 16px; }

            .orig-title {
                font-size: 22px;
                font-weight: 700;
                color: var(--color-text);
                margin-bottom: 10px;
                line-height: 1.4;
            }

            .orig-text {
                font-size: 20px;
                color: var(--color-subtext);
                line-height: 1.7;
                white-space: pre-wrap;
                max-height: 800px;
                overflow: hidden;
            }
            .orig-text.truncated::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 120px;
                background: linear-gradient(to bottom, transparent, var(--color-card-bg));
                pointer-events: none;
            }

            .stats {
                display: flex;
                gap: 24px;
                font-size: 26px;
                color: var(--color-subtext);
                align-items: center;
                margin: 16px 0 12px 0;
                width: 100%;
            }

            .video-stats {
                background: transparent;
            }

            .theme-dark .video-stats {
                background: transparent;
            }

            .action-bar {
                display: flex;
                align-items: center;
                gap: 48px;
                margin-top: 20px;
                padding-top: 20px;
                border-top: 1px solid var(--color-border);
                width: 100%;
            }

            .action-item {
                display: flex;
                align-items: center;
                gap: 12px;
                font-size: 26px;
                color: var(--color-subtext);
                font-weight: 500;
            }

            .action-item svg {
                width: 32px;
                height: 32px;
                fill: var(--color-subtext);
                opacity: 0.85;
            }

            .stat-item {
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 600;
                color: var(--color-subtext);
                white-space: nowrap;
            }

            .stat-item svg {
                fill: var(--color-subtext);
                width: 30px;
                height: 30px;
            }

            .globe-icon {
                width: 24px;
                height: 24px;
                vertical-align: middle;
            }

            .images-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 12px;
                margin-top: 20px;
            }
            .images-grid.cols-2 {
                grid-template-columns: repeat(2, 1fr);
            }

            .images-grid img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                aspect-ratio: 1/1;
                border-radius: var(--radius-md);
                cursor: pointer;
                transition: transform 0.2s;
                box-shadow: var(--shadow-sm);
            }

            .single-image {
                margin-top: 20px;
                width: 100%;
                max-height: 1500px;
                object-fit: cover;
                border-radius: var(--radius-lg);
                display: block;
                box-shadow: var(--shadow-md);
            }

            .dynamic-image {
                margin-top: 24px;
                width: 100%;
                max-height: 1500px;
                object-fit: cover;
                border-radius: var(--radius-lg);
                display: block;
                box-shadow: var(--shadow-md);
            }

            .live-badge-status {
                display: inline-block;
                padding: 4px 12px;
                border-radius: var(--radius-md);
                font-size: 14px;
                font-weight: 700;
                margin-left: 10px;
                vertical-align: middle;
                transform: translateY(-1px);
            }

            .live-on {
                background: linear-gradient(135deg, var(--color-emphasis), ${adjustBrightness('#FF6699', -10)});
                color: white;
                box-shadow: var(--shadow-sm);
            }

            .live-off {
                background: var(--color-soft-bg-2);
                color: var(--color-subtext);
            }

            .video-tag {
                background: var(--color-soft-bg);
                color: var(--color-subtext);
                padding: 4px 10px;
                border-radius: var(--radius-sm);
                font-size: 14px;
                margin-right: 8px;
                vertical-align: middle;
                font-weight: 500;
            }

            .duration-badge {
                position: absolute;
                bottom: 8px;
                right: 8px;
                background: rgba(0, 0, 0, 0.65);
                color: white;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 14px;
                font-weight: 500;
                backdrop-filter: blur(4px);
            }

            /* Rich Text & Special Content */
            .emoji {
                width: 32px;
                height: 32px;
                vertical-align: text-bottom;
                margin: 0 2px;
                display: inline-block;
            }

            .at-user {
                color: var(--color-secondary);
                font-weight: 700;
                margin: 0 2px;
                cursor: pointer;
            }

            .topic-tag {
                color: var(--color-secondary);
                margin: 0 2px;
                font-weight: 700;
            }

            .vote-card {
                background: var(--color-soft-bg);
                border-radius: var(--radius-lg);
                padding: 20px;
                margin-top: 24px;
                border: 1px solid var(--color-border);
                box-shadow: var(--shadow-sm);
                width: 100%;
                box-sizing: border-box;
            }

            .vote-header {
                font-size: 24px;
                font-weight: 700;
                color: var(--color-text);
                margin-bottom: 16px;
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .vote-icon {
                width: 28px;
                height: 28px;
                fill: var(--color-secondary);
            }

            .vote-footer {
                margin-top: 16px;
                display: flex;
                gap: 12px;
                font-size: 16px;
                color: var(--color-subtext);
                align-items: center;
            }

            .vote-type-text {
                font-weight: 500;
                color: var(--color-subtext);
            }

            .vote-options {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .vote-options.with-images {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
            }

            .vote-item {
                background: var(--color-card-bg);
                padding: 16px 20px;
                border-radius: var(--radius-md);
                font-size: 22px;
                color: var(--color-text);
                border: 1px solid var(--color-border);
                display: flex;
                justify-content: space-between;
                align-items: center;
                transition: background-color 0.2s;
            }

            .vote-item.has-image {
                flex-direction: column;
                padding: 12px;
                align-items: stretch;
                text-align: center;
            }

            .vote-stat-bar {
                position: absolute;
                left: 0;
                top: 0;
                bottom: 0;
                background: rgba(0, 161, 214, 0.1);
                z-index: 0;
                transition: width 0.5s ease;
            }

            .vote-item-content {
                position: relative;
                z-index: 1;
                display: flex;
                justify-content: space-between;
                align-items: center;
                width: 100%;
            }

            .vote-stat-text {
                font-size: 16px;
                color: var(--color-subtext);
                margin-left: 10px;
                font-weight: 500;
            }

            .vote-item-image {
                width: 100%;
                aspect-ratio: 1;
                border-radius: var(--radius-sm);
                overflow: hidden;
                margin-bottom: 10px;
            }

            .vote-item-image img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }

            .vote-footer {
                margin-top: 16px;
                color: var(--color-subtext);
                font-size: 18px;
                display: flex;
                align-items: center;
                gap: 12px;
            }

             .vote-btn {
                 background: var(--color-emphasis);
                 color: white;
                 padding: 8px 24px;
                 border-radius: var(--radius-md);
                 font-weight: 700;
                 font-size: 18px;
             }

             .vote-inline {
                color: var(--color-secondary);
                font-weight: 700;
                margin: 0 2px;
            }

            .video-card-inline {
                margin-top: 20px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                overflow: hidden;
                background: var(--color-card-bg);
            }
            .video-card-content {
                padding: 12px;
                background: var(--color-soft-bg);
            }
            .video-card-title {
                font-weight: bold;
                font-size: 14px;
                margin-bottom: 6px;
                color: var(--color-text);
            }
            .stat-inline-container {
                color: var(--color-subtext);
                font-size: 13px;
                display: flex;
                gap: 15px;
                align-items: center;
                margin-top: 4px;
            }
            .stat-inline {
                display: flex;
                align-items: center;
                gap: 4px;
                white-space: nowrap;
            }
            .stat-inline svg {
                width: 16px;
                height: 16px;
                fill: var(--color-subtext);
            }
         </style>
     `;
}

module.exports = {
    isNightMode,
    calculateViewport,
    getTypeConfig,
    calculateColors,
    generateCSS,
    adjustBrightness,
    hexToRgba
};
