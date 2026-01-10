// 统一的设计系统配置
const DESIGN_SYSTEM = {
    // 统一字体配置
    typography: {
        title: '42px',           // 主标题
        subtitle: '28px',        // 副标题
        sectionTitle: '26px',    // 章节标题
        body: '24px',            // 正文
        caption: '20px',         // 说明文字
        small: '16px'            // 小字
    },
    
    // 统一圆角
    radius: {
        sm: '6px',
        md: '10px',
        lg: '18px',
        container: '20px'        // 容器统一使用20px
    },
    
    // 统一间距
    spacing: {
        container: '24px',       // 容器padding
        card: '28px',           // 卡片padding
        section: '28px',        // 章节间距
        item: '16px'            // 项目间距
    },
    
    // Type Badge配置
    typeBadge: {
        fontSize: '28px',
        padding: '16px 28px',
        gap: '12px',
        marginBottom: '20px',
        fontWeight: '700'
    }
};

// 统一的CSS生成函数
function generateUnifiedCSS(colorData, viewport, options = {}) {
    const { currentType, badgeColor, badgeBg, badgeTextColor, badgeShadow, badgeBorder } = colorData;
    const { minWidth = 400, width = 1200 } = viewport;
    const { customFontsCss = '', customFontFamilies = [] } = options;

    return `
        <style>
            /* Custom Fonts */
            ${customFontsCss}

            /* 统一设计Token */
            :root {
                /* 调色板 - 浅色模式 */
                --color-bg: #F5F7FA;
                --color-card-bg: rgba(255, 255, 255, 0.75);
                --color-text: #1A1A1A;
                --color-subtext: #5A5F66;
                --color-border: rgba(0, 0, 0, 0.08);
                --color-soft-bg: #F0F2F5;
                --color-soft-bg-2: #EDEFF3;

                /* 强调色 */
                --color-primary: ${currentType?.color || '#FB7299'};
                --color-secondary: #00A1D6;
                --color-emphasis: #FF6699;

                /* 统一圆角 */
                --radius-sm: ${DESIGN_SYSTEM.radius.sm};
                --radius-md: ${DESIGN_SYSTEM.radius.md};
                --radius-lg: ${DESIGN_SYSTEM.radius.lg};
                --radius-container: ${DESIGN_SYSTEM.radius.container};

                /* 统一阴影 */
                --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.06);
                --shadow-md: 0 6px 20px rgba(0, 0, 0, 0.10);
                --shadow-lg: 0 10px 32px rgba(0, 0, 0, 0.14);
                --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);

                /* 统一字体大小 */
                --font-title: ${DESIGN_SYSTEM.typography.title};
                --font-subtitle: ${DESIGN_SYSTEM.typography.subtitle};
                --font-section-title: ${DESIGN_SYSTEM.typography.sectionTitle};
                --font-body: ${DESIGN_SYSTEM.typography.body};
                --font-caption: ${DESIGN_SYSTEM.typography.caption};
                --font-small: ${DESIGN_SYSTEM.typography.small};

                /* 统一间距 */
                --spacing-container: ${DESIGN_SYSTEM.spacing.container};
                --spacing-card: ${DESIGN_SYSTEM.spacing.card};
                --spacing-section: ${DESIGN_SYSTEM.spacing.section};
                --spacing-item: ${DESIGN_SYSTEM.spacing.item};
            }

            /* 深色主题 */
            .theme-dark {
                --color-bg: rgba(0, 0, 0, 0.9);
                --color-card-bg: rgba(23, 27, 33, 0.75);
                --color-text: #E8EAED;
                --color-subtext: #A8ADB4;
                --color-border: rgba(255, 255, 255, 0.08);
                --color-soft-bg: #12161B;
                --color-soft-bg-2: #0D1014;
                --color-primary: ${badgeColor || '#FB7299'};

                --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.60);
                --shadow-md: 0 6px 20px rgba(0, 0, 0, 0.65);
                --shadow-lg: 0 10px 32px rgba(0, 0, 0, 0.70);
                --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2);
            }

            body {
                margin: 0;
                padding: 0;
                background: transparent;
                width: fit-content;
                min-width: ${minWidth}px;
                max-width: ${width}px;
                font-family: ${customFontFamilies.length > 0 ? customFontFamilies.join(', ') + ', ' : ''}"MiSans", "MiSans L3", "Noto Sans SC", "Noto Color Emoji", sans-serif;
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
            }

            /* 统一容器样式 */
            .container {
                padding: var(--spacing-container);
                background: var(--color-bg);
                box-sizing: border-box;
                width: 100%;
                min-height: 300px;
                display: inline-flex;
                flex-direction: column;
                align-items: flex-start;
                border-radius: var(--radius-container);
                transition: background-color .3s ease;
            }

            /* 统一卡片样式 */
            .card {
                position: relative;
                background: var(--color-card-bg);
                border-radius: var(--radius-lg);
                overflow: hidden;
                box-shadow: var(--shadow-card);
                border: 1px solid var(--color-border);
                transition: background-color .3s ease, box-shadow .3s ease, border-color .3s ease;
                backdrop-filter: blur(24px);
                -webkit-backdrop-filter: blur(24px);
                padding: var(--spacing-card);
                width: 100%;
                box-sizing: border-box;
            }

            /* 统一渐变背景 */
            .container.gradient-bg { position: relative; }
            .container.gradient-bg::before {
                content: '';
                position: absolute;
                inset: 0;
                background: var(--gradient-mix);
                opacity: 0.18;
                z-index: 0;
                border-radius: var(--radius-container);
            }
            @supports (backdrop-filter: blur(2px)) {
                .container.gradient-bg::before {
                    backdrop-filter: blur(2px);
                }
            }
            .container.gradient-bg > * {
                position: relative;
                z-index: 1;
            }

            /* 统一 Type Badge 样式 */
            .type-badge {
                display: inline-flex;
                align-items: center;
                gap: ${DESIGN_SYSTEM.typeBadge.gap};
                margin-bottom: ${DESIGN_SYSTEM.typeBadge.marginBottom};
                margin-left: 6px;
                background: ${badgeBg || 'var(--color-primary)'};
                color: ${badgeTextColor || '#fff'};
                padding: ${DESIGN_SYSTEM.typeBadge.padding};
                border-radius: var(--radius-lg);
                font-size: ${DESIGN_SYSTEM.typeBadge.fontSize};
                font-weight: ${DESIGN_SYSTEM.typeBadge.fontWeight};
                box-shadow: ${badgeShadow || 'var(--shadow-sm)'};
                border: ${badgeBorder || 'none'};
                text-shadow: ${colorData?.themeClass === 'theme-dark' ? 'none' : '0 2px 4px rgba(0, 0, 0, 0.2)'};
                letter-spacing: 1px;
                line-height: 1;
            }

            /* 统一标题样式 */
            .page-title {
                font-size: var(--font-title);
                font-weight: 800;
                background: linear-gradient(135deg, #FB7299, #FF6699);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                margin-bottom: 8px;
                letter-spacing: 1px;
                text-align: center;
            }

            .page-subtitle {
                font-size: var(--font-subtitle);
                color: var(--color-subtext);
                font-weight: 500;
                text-align: center;
            }

            /* 统一章节标题 */
            .section {
                margin-bottom: var(--spacing-section);
            }

            .section-title {
                font-size: var(--font-section-title);
                font-weight: 700;
                color: var(--color-text);
                margin-bottom: var(--spacing-item);
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .section-title::before {
                content: '';
                display: block;
                width: 5px;
                height: 24px;
                background: linear-gradient(135deg, #00A1D6, #00B5E5);
                border-radius: 3px;
                box-shadow: 0 2px 8px rgba(0, 161, 214, 0.3);
            }

            /* 统一标题分隔线 */
            .header-divider {
                border-bottom: 2px solid var(--color-border);
                padding-bottom: 20px;
                margin-bottom: var(--spacing-section);
            }

            /* 统一数量徽章 */
            .count-badge {
                background: var(--color-primary);
                color: white;
                font-size: 12px;
                padding: 2px 8px;
                border-radius: 10px;
                font-weight: bold;
            }

            /* 统一页脚 */
            .footer {
                text-align: center;
                font-size: var(--font-small);
                color: var(--color-subtext);
                margin-top: 12px;
                font-weight: 400;
                opacity: 0.8;
            }
        </style>
    `;
}

// 统一的Type Badge渲染函数
function renderUnifiedTypeBadge(type, label, icon, isVisible = true) {
    if (!isVisible) return '';
    
    return `
        <div class="type-badge">
            <span>${icon}</span>
            <span>${label}</span>
        </div>
    `;
}

// 统一的页面头部渲染函数
function renderUnifiedHeader(title, subtitle = '', showDivider = true) {
    return `
        <div class="header ${showDivider ? 'header-divider' : ''}">
            <h1 class="page-title">${title}</h1>
            ${subtitle ? `<div class="page-subtitle">${subtitle}</div>` : ''}
        </div>
    `;
}

// 统一的页脚渲染函数
function renderUnifiedFooter(text, extraContent = '') {
    return `
        <div class="footer">
            ${extraContent}
            <div>${text}</div>
        </div>
    `;
}

// 导出统一配置
module.exports = {
    DESIGN_SYSTEM,
    generateUnifiedCSS,
    renderUnifiedTypeBadge,
    renderUnifiedHeader,
    renderUnifiedFooter
};
