const puppeteer = require('puppeteer');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// SVG Icons (Unified Style - Material Designish)
const ICONS = {
    view: '<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>',
    like: '<svg viewBox="0 0 24 24"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1.91l-.01-.01L23 10z"/></svg>',
    comment: '<svg viewBox="0 0 24 24"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>',
    fire: '<svg viewBox="0 0 24 24"><path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M18 16.1c-.8 0-1.4.3-1.9.8l-7.1-4.2c.1-.2.1-.5.1-.7s0-.5-.1-.7L16.1 7.1c.5.5 1.1.8 1.9.8 1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3c0 .2 0 .5.1.7L8 9.8C7.5 9.3 6.8 9 6 9c-1.7 0-3 1.3-3 3s1.3 3 3 3c.8 0 1.5-.3 1.9-.8l7.1 4.2c-.1.2-.1.4-.1.6 0 1.6 1.3 2.9 2.9 2.9s2.9-1.3 2.9-2.9-1.3-2.9-2.9-2.9z"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>'
};

class ImageGenerator {
    constructor() {
        this.browser = null;
    }

    async init() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-features=VizDisplayCompositor',
                    '--memory-pressure-off',
                    '--max_old_space_size=4096'
                ],
                headless: "new"
            });
        }
    }

    isNightMode(groupId) {
        const nightMode = config.getGroupConfig(groupId, 'nightMode');
        if (!nightMode) return false;
        const { mode, startTime, endTime } = nightMode;
        
        if (mode === 'on') return true;
        if (mode === 'off') return false;
        
        // Timed
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

    async generatePreviewCard(data, type, groupId, show_id = true) {
        await this.init();
        const page = await this.browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 根据内容类型动态决定宽度
        let baseWidth = 1200;
        let minWidth = 400;

        // 对于动态类型，分析内容决定宽度
        if (type === 'dynamic') {
            const modules = data.data?.item?.modules || data.data?.modules || {};
            const module_dynamic = modules.module_dynamic || {};

            // 检查是否有图片或视频
            const hasImages = module_dynamic.major?.draw?.items?.length > 0 ||
                            module_dynamic.major?.opus?.pics?.length > 0;
            const hasVideo = !!module_dynamic.major?.archive || !!module_dynamic.major?.live_rcmd;
            const hasOrig = !!(data.data?.item?.orig || data.data?.orig);

            if (hasImages || hasVideo || hasOrig) {
                baseWidth = 1100;  // 有媒体内容时使用更宽的布局
            } else {
                baseWidth = 800;   // 纯文字动态使用较窄布局
            }
        } else if (type === 'video' || type === 'live') {
            baseWidth = 1000;
        } else if (type === 'bangumi') {
            baseWidth = 950;
        } else if (type === 'article') {
            baseWidth = 1080;
        } else if (type === 'user') {
            baseWidth = 900;
        }

        // 设置高质量视口以保证清晰度
        await page.setViewport({
            width: baseWidth,
            height: 1200,  // 增加高度以容纳更多内容
            deviceScaleFactor: 1.1  // 降低缩放以减小体积
        });

        // Theme: auto switch by config
        const isNight = this.isNightMode(groupId);
        const themeClass = isNight ? 'theme-dark' : 'theme-light';
        
        // Type Config (Label & Color)
        const TYPE_CONFIG = {
            video: { label: '视频', color: '#FB7299', icon: '▶️' },
            bangumi: { label: '番剧', color: '#00A1D6', icon: '🎬' },
            article: { label: '专栏', color: '#FAA023', icon: '📰' },
            live: { label: '直播', color: '#FF6699', icon: '📡' },
            dynamic: { label: '动态', color: '#00B5E5', icon: '📱' },
            user: { label: '用户', color: '#FB7299', icon: '👤' }
        };
        let currentType = TYPE_CONFIG[type] || { label: 'Bilibili', color: '#FB7299', icon: '' };

        // 针对番剧类型的细分处理 (电影、纪录片等)
        if (type === 'bangumi' && data.data) {
             const seasonType = data.data.season_type;
             // 1:番剧, 2:电影, 3:纪录片, 4:国创, 5:电视剧, 7:综艺
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

        // 调整夜间模式下的标签颜色
        const badgeColor = isNight ? this.adjustBrightness(currentType.color, -25) : currentType.color;

        const isHex = (c) => typeof c === 'string' && /^#([0-9a-fA-F]{6})$/.test(c);
        const clamp01 = (n) => Math.max(0, Math.min(1, n));
        const hexToRgb = (hex) => {
            const h = hex.replace('#', '');
            return {
                r: parseInt(h.slice(0, 2), 16),
                g: parseInt(h.slice(2, 4), 16),
                b: parseInt(h.slice(4, 6), 16)
            };
        };
        const relLuminance = (hex) => {
            const { r, g, b } = hexToRgb(hex);
            const srgb = [r, g, b].map(v => v / 255);
            const f = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            const [R, G, B] = srgb.map(f);
            return 0.2126 * R + 0.7152 * G + 0.0722 * B;
        };
        const pickTextColor = (bgHex) => {
            if (!isHex(bgHex)) return isNight ? '#E8EAED' : '#1A1A1A';
            const lum = relLuminance(bgHex);
            return lum > 0.5 ? '#1A1A1A' : '#E8EAED';
        };

        const parseRichText = (nodes, rawText) => {
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
                        // Escape HTML for text
                        return text.replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;")
                            .replace(/"/g, "&quot;")
                            .replace(/'/g, "&#039;")
                            .replace(/\n/g, '<br>');
                    }
                }).join('');
            }
            // Fallback for raw text
            return (rawText || '').replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;")
                .replace(/\n/g, '<br>');
        };

        const renderVoteCard = (vote) => {
             if (!vote) return '';
             const title = vote.desc || vote.title || '投票';
             const items = vote.items || vote.options || [];
             const totalFromApi = vote.join_num || vote.participant || vote.total || vote.total_num || 0;
             const sumCnt = items.reduce((acc, i) => acc + (i.cnt || 0), 0);
             const total = Math.max(totalFromApi, sumCnt); // Use the larger one to be safe

             const choiceCnt = vote.choice_cnt || vote.choiceCount || (vote.multi_select ? 2 : 1) || 1;
             const hasVoteImages = items.some(item => item.image);
             
             return `
                <div class="vote-card">
                    <div class="vote-header">
                        <svg class="vote-icon" viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>
                        ${title}
                    </div>
                    <div class="vote-options ${hasVoteImages ? 'with-images' : ''}">
                        ${items.map(item => {
                            const cnt = item.cnt || 0;
                            const percent = total > 0 ? Math.round((cnt / total) * 100) : 0;
                            return `
                            <div class="vote-item ${item.image ? 'has-image' : ''}" style="position: relative; overflow: hidden;">
                                ${total > 0 ? `<div class="vote-stat-bar" style="width: ${percent}%;"></div>` : ''}
                                ${item.image ? `<div class="vote-item-image"><img src="${item.image}" /></div>` : ''}
                                <div class="vote-item-content" ${item.image ? 'style="flex-direction:column; gap:8px;"' : ''}>
                                    <span class="vote-text">${item.desc || item.name || item.text || ''}</span>
                                    ${total > 0 ? `<span class="vote-stat-text">${cnt}票 (${percent}%)</span>` : ''}
                                </div>
                            </div>
                        `}).join('')}
                    </div>
                    <div class="vote-footer">
                        <span class="vote-type-text">${choiceCnt > 1 ? '多选' : '单选'}</span>
                        <span class="vote-total-text">${this.formatNumber(total)}人参与</span>
                    </div>
                </div>
             `;
        };
 
        const normalizeVote = (v) => {
            if (!v) return null;
            return {
                desc: v.desc || v.title || '',
                items: v.items || v.options || [],
                join_num: v.join_num || v.participant || v.total || v.total_num || 0,
                choice_cnt: v.choice_cnt || v.choiceCount || (v.multi_select ? 2 : 1) || 1
            };
        };
 
        const getVoteFromModules = (modules) => {
            if (!modules) return null;
            const mi = modules.module_interaction || {};
            let v = mi.vote || mi.vote_info || null;
            if (v && v.vote) v = v.vote;
            if (!v) {
                const major = (modules.module_dynamic || {}).major || {};
                v = major.vote || null;
            }
            if (!v) {
                const additional = (modules.module_dynamic || {}).additional || {};
                v = additional.vote || null;
            }
            return normalizeVote(v);
        };

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
        if (colors.length === 0) {
            addColor(currentType.color);
        }
        if (colors.length === 1) {
            addColor(this.adjustBrightness(colors[0], -10));
        }
        if (colors.length === 2) {
            addColor(this.adjustBrightness(colors[0], 12));
        }
        const stops = colors.map((c, i) => {
            const pct = colors.length > 1 ? Math.round(i * 100 / (colors.length - 1)) : 100;
            return `${c} ${pct}%`;
        });
        const gradientMix = `linear-gradient(135deg, ${stops.join(', ')})`;

        // Night mode badge adjustments
        const badgeBg = isNight ? '#23272D' : `linear-gradient(135deg, ${badgeColor}, ${this.adjustBrightness(badgeColor, -10)})`;
        const badgeTextColor = isNight ? badgeColor : '#fff';
        const badgeShadow = isNight ? 'none' : `0 8px 24px ${this.hexToRgba(currentType.color, 0.40)}, var(--shadow-sm)`;
        const badgeBorder = isNight ? `1px solid ${this.hexToRgba(badgeColor, 0.3)}` : 'none';

        // Load Custom Fonts
        const fontDir = path.join(__dirname, '../../fonts/custom');
        let customFontsCss = '';
        let customFontFamilies = [];
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
                        customFontsCss += `
                            @font-face {
                                font-family: "${fontName}";
                                src: url(data:font/${ext.slice(1)};charset=utf-8;base64,${base64Font}) format('${ext === '.ttf' ? 'truetype' : ext === '.otf' ? 'opentype' : ext.slice(1)}');
                            }
                        `;
                        customFontFamilies.push(`"${fontName}"`);
                    }
                });
            } catch (e) {
                logger.error('Failed to load custom fonts:', e);
            }
        }

        // 现代化美化的 CSS 样式
        const style = `
            <style>
                /* Custom Fonts */
                ${customFontsCss}

                /* Design Tokens */
                :root {
                    /* Palette - Light */
                    --color-bg: #F5F7FA;
                    --color-card-bg: #FFFFFF;
                    --color-text: #1A1A1A;
                    --color-subtext: #5A5F66;
                    --color-border: rgba(0, 0, 0, 0.08);
                    --color-soft-bg: #F0F2F5;
                    --color-soft-bg-2: #EDEFF3;

                    /* Accent */
                    --color-primary: ${currentType.color};
                    --color-secondary: #00A1D6;
                    --color-emphasis: #FF6699;

                    /* Radii */
                    --radius-sm: 4px;
                    --radius-md: 6px;
                    --radius-lg: 8px;

                    /* Shadows */
                    --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.06);
                    --shadow-md: 0 6px 20px rgba(0, 0, 0, 0.10);
                    --shadow-lg: 0 10px 32px rgba(0, 0, 0, 0.14);
                }

                /* Dark Theme Override */
                .theme-dark {
                    --color-bg: rgba(0, 0, 0, 0.9);
                    --color-card-bg: #171B21;
                    --color-text: #E8EAED;
                    --color-subtext: #A8ADB4;
                    --color-border: rgba(255, 255, 255, 0.08);
                    --color-soft-bg: #12161B;
                    --color-soft-bg-2: #0D1014;
                    --color-primary: ${badgeColor};

                    --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.60);
                    --shadow-md: 0 6px 20px rgba(0, 0, 0, 0.65);
                    --shadow-lg: 0 10px 32px rgba(0, 0, 0, 0.70);
                }

                body {
                    margin: 0;
                    padding: 0;
                    background: transparent;
                    width: fit-content;
                    min-width: ${minWidth}px;
                    max-width: ${baseWidth}px;
                    font-family: ${customFontFamilies.length > 0 ? customFontFamilies.join(', ') + ', ' : ''}"MiSans", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                }

                .container {
                    padding: 24px;
                    background: var(--color-bg);
                    box-sizing: border-box;
                    width: 100%;
                    min-height: 300px;
                    display: inline-flex;
                    flex-direction: column;
                    align-items: flex-start;
                    border-radius: var(--radius-lg);
                    transition: background-color .3s ease;
                }

                 .card {
                     position: relative;
                     background: var(--color-card-bg);
                     border-radius: var(--radius-lg);
                     overflow: hidden;
                     box-shadow: var(--shadow-lg);
                     border: 1px solid var(--color-border);
                     transition: background-color .3s ease, box-shadow .3s ease, border-color .3s ease;
                 }
                
                .container.gradient-bg { position: relative; }
                .container.gradient-bg::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    background: var(--gradient-mix);
                    opacity: 0.18;
                    z-index: 0;
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

                /* Type Badge - 更现代的设计 - 放大版 */
                .type-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 20px;
                    margin-left: 6px;
                    background: ${badgeBg};
                    color: ${badgeTextColor};
                    padding: 16px 28px;
                    border-radius: var(--radius-lg);
                    font-size: 28px;
                    font-weight: 700;
                    box-shadow: ${badgeShadow};
                    border: ${badgeBorder};
                    text-shadow: ${isNight ? 'none' : '0 2px 4px rgba(0, 0, 0, 0.2)'};
                    letter-spacing: 1px;
                    line-height: 1;
                }

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
                    width: 64px;
                    height: 64px;
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
                }

                .user-level {
                    background: linear-gradient(135deg, #FFB300, #FF8F00);
                    color: #fff;
                    font-size: 16px;
                    padding: 4px 10px;
                    border-radius: var(--radius-md);
                    font-weight: 700;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
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
                    background: rgba(255, 255, 255, 0.2);
                    padding: 4px 8px;
                    border-radius: var(--radius-md);
                    font-weight: 700;
                    font-size: 20px;
                    backdrop-filter: blur(4px);
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
                    text-align: justify;
                }
                .text-content.truncated {
                    max-height: 1100px;
                    overflow: hidden;
                    position: relative;
                }
                .text-content.truncated::after {
                    content: '';
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    width: 100%;
                    height: 160px;
                    background: linear-gradient(to bottom, transparent, var(--card-bg));
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
                    text-align: justify;
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
                }
                .orig-text.truncated {
                    max-height: 800px;
                    overflow: hidden;
                    position: relative;
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
                    gap: 28px;
                    font-size: 28px;
                    color: var(--color-subtext);
                    align-items: center;
                    margin-bottom: 12px;
                    background: var(--color-soft-bg);
                    padding: 16px 20px;
                    border-radius: var(--radius-md);
                    width: fit-content;
                    box-shadow: var(--shadow-sm);
                }

                .action-bar {
                    display: flex;
                    align-items: center;
                    gap: 48px;
                    margin-top: 24px;
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
                    gap: 10px;
                    font-weight: 600;
                    color: var(--color-subtext);
                    white-space: nowrap;
                }

                .stat-item svg {
                    fill: var(--color-subtext);
                    width: 32px;
                    height: 32px;
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
                    max-height: 500px;
                    object-fit: contain;
                    border-radius: var(--radius-lg);
                    display: block;
                    height: auto;
                    box-shadow: var(--shadow-md);
                }

                .dynamic-image {
                    margin-top: 24px;
                    width: 100%;
                    height: auto;
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
                    background: linear-gradient(135deg, var(--color-emphasis), ${this.adjustBrightness('#FF6699', -10)});
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

        let htmlContent = `<html><head>${style}</head><body>
            <div class="container ${themeClass} gradient-bg ${type === 'article' ? 'article-mode' : ''}" style="--gradient-mix:${gradientMix}">
                ${(function() {
                    const labelConfig = config.getGroupConfig(groupId, 'labelConfig');
                    
                    // Determine subtype for granular control
                    let subtype = type;
                    if (type === 'bangumi' && data.data) {
                        const st = data.data.season_type;
                        if (st === 2) subtype = 'movie';
                        else if (st === 3) subtype = 'doc';
                        else if (st === 4) subtype = 'guocha';
                        else if (st === 5) subtype = 'tv';
                        else if (st === 7) subtype = 'variety';
                    }
                    
                    // Check subtype config first, then fallback to type config
                    const isVisible = (labelConfig && labelConfig[subtype] !== undefined) 
                        ? labelConfig[subtype] 
                        : (labelConfig && labelConfig[type] !== false);

                    return isVisible ? `
                <div class="type-badge">
                    <span>${currentType.icon}</span>
                    <span>${currentType.label}</span>
                </div>` : '';
                })()}
                <div class="card">
        `;

        // ---------------- VIDEO ----------------
        if (type === 'video') {
            const info = data.data;
            // Format duration (in seconds) to MM:SS or HH:MM:SS format
            const formatDuration = (seconds) => {
                if (!seconds) return '';
                const h = Math.floor(seconds / 3600);
                const m = Math.floor((seconds % 3600) / 60);
                const s = Math.floor(seconds % 60);

                if (h > 0) {
                    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
                } else {
                    return `${m}:${s.toString().padStart(2, '0')}`;
                }
            };

            const durationStr = info.duration ? ` • 时长: ${formatDuration(info.duration)}` : '';

            htmlContent += `
                <div class="cover-container">
                    <img class="cover video" src="${info.pic}" />
                </div>
                <div class="content">
                    <div class="header">
                        <div class="header-left">
                            <div class="avatar-wrapper">
                                <img class="avatar no-frame" src="${info.owner.face}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                            </div>
                            <div class="user-info">
                                <span class="user-name">${info.owner.name}</span>
                                <span class="pub-time">${this.formatPubTime(info.pubdate)}${durationStr}</span>
                            </div>
                        </div>
                    </div>
                    <div class="title">${info.title}</div>
                    <div class="stats">
                        <span class="stat-item">${ICONS.view} ${this.formatNumber(info.view?.count || info.stat?.view)}</span>
                        <span class="stat-item">${ICONS.like} ${this.formatNumber(info.like || info.stat?.like)}</span>
                        <span class="stat-item">${ICONS.comment} ${this.formatNumber(info.reply || info.stat?.reply)}</span>
                    </div>
                    <div class="text-content">${info.desc || ''}</div>
                </div>
            `;
        } 
        // ---------------- BANGUMI ----------------
        else if (type === 'bangumi') {
            const info = data.data;
            
            // Format publish info
            const releaseDate = info.publish?.release_date_show || '未知';
            const isFinish = info.publish?.is_finish === 1;
            const seasonType = info.season_type;
            const typeDesc = info.type_desc || '';
            const stylesArr = info.styles || [];
            const isMovieOrDoc = (seasonType === 2 || seasonType === 3) 
                || stylesArr.includes('电影') || stylesArr.includes('纪录片')
                || /电影|纪录/.test(typeDesc);
            
            let statusText = '';
            const styles = info.styles || [];
            const areas = info.areas || [];
            const areaStr = areas.length > 0 ? areas.map(a => a.name).join('/') : '';
            const stylesStr = styles.length > 0 ? styles.join('/') : '';
            const metaSuffix = `${areaStr}${stylesStr ? (areaStr ? ' ' + stylesStr : stylesStr) : ''}`.trim();

            if (isFinish) {
                const epDesc = (info.new_ep?.desc || '').replace(/,\s*/g, ' ');
                statusText = isMovieOrDoc
                    ? `${releaseDate}开播`
                    : `${releaseDate}开播 ${epDesc}`;
            } else {
                const pubTime = info.publish?.pub_time || '';
                let updateSchedule = '';
                if (pubTime) {
                    const dateStr = pubTime.replace(' ', 'T');
                    const date = new Date(dateStr);
                    if (!isNaN(date.getTime())) {
                        const days = ['日', '一', '二', '三', '四', '五', '六'];
                        const weekday = days[date.getDay()];
                        const time = pubTime.split(' ')[1].substring(0, 5);
                        updateSchedule = `每周${weekday} ${time}更新`;
                    }
                }
                let epUpdateText = '';
                if (!isMovieOrDoc) {
                    const epTitle = info.new_ep?.title || info.new_ep?.index_show || '';
                    if (epTitle) {
                        const epNumber = parseInt(epTitle, 10);
                        if (!isNaN(epNumber)) {
                            epUpdateText = `更新至第${epNumber}集`;
                        }
                    }
                }
                statusText = isMovieOrDoc
                    ? `${releaseDate}开播`
                    : `${releaseDate}开播 连载中${epUpdateText ? ' ' + epUpdateText : ''}${updateSchedule ? ' ' + updateSchedule : ''}`;
            }

            htmlContent += `
                <div class="cover-container">
                    <img class="cover bangumi" src="${info.cover}" />
                </div>
                <div class="content">
                    <div class="title">${info.title}</div>
                    <div class="status-line">
                        <span class="status-prefix">${statusText}</span>
                        ${metaSuffix ? `<span class="status-meta">${metaSuffix}</span>` : ''}
                    </div>
                    <div class="stats">
                        <span class="stat-item">${ICONS.view} ${this.formatNumber(info.stat?.views)}</span>
                        <span class="stat-item">${ICONS.heart} ${this.formatNumber(info.stat?.follow)}</span>
                        <span class="stat-item">${ICONS.comment} ${this.formatNumber(info.stat?.danmakus)}</span>
                        <span class="stat-item">${ICONS.star} ${info.rating?.score || 'N/A'}分</span>
                    </div>
                    <div class="text-content">${info.desc || ''}</div>
                </div>
            `;
        } 
        // ---------------- ARTICLE ----------------
        else if (type === 'article') {
            const info = data.data;
            const cover = info.banner_url || (info.image_urls && info.image_urls.length > 0 ? info.image_urls[0] : '');
            const pubDate = this.formatPubTime(info.publish_time);
            const authorFace = info.author_face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';

            htmlContent += `
                ${cover ? `<div class="cover-container"><img class="cover article" src="${cover}" /></div>` : ''}
                <div class="content">
                    <div class="header">
                        <div class="header-left">
                            <div class="avatar-wrapper">
                                <img class="avatar no-frame" src="${authorFace}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                            </div>
                            <div class="user-info">
                                <span class="user-name">${info.author_name || 'Unknown'}</span>
                                <span class="pub-time">${pubDate}</span>
                            </div>
                        </div>
                    </div>
                    <div class="title">${info.title}</div>
                    <div class="text-content truncated">${info.summary || ''}</div>
                    <div class="stats" style="margin-top: 20px;">
                        <span class="stat-item">${ICONS.share} ${this.formatNumber(info.stats?.share)}</span>
                        <span class="stat-item">${ICONS.like} ${this.formatNumber(info.stats?.like)}</span>
                        <span class="stat-item">${ICONS.comment} ${this.formatNumber(info.stats?.reply)}</span>
                    </div>
                </div>
            `;
        } 
        // ---------------- LIVE ----------------
        else if (type === 'live') {
            const info = data.data;
            const roomInfo = info.room_info || {};
            const anchorInfo = info.anchor_info || {};
            const watched = info.watched_show || {};
            
            const isLive = roomInfo.live_status === 1;
            const liveBadge = isLive
                ? `<span class="live-badge-status live-on" style="font-size: 20px; padding: 6px 12px; margin-left: 10px;">LIVE</span>`
                : `<span class="live-badge-status live-off" style="font-size: 20px; padding: 6px 12px; margin-left: 10px;">OFFLINE</span>`;

            htmlContent += `
                <div class="cover-container">
                    <img class="cover live" src="${roomInfo.cover}" />
                </div>
                <div class="content">
                    <div class="header">
                        <div class="header-left">
                            <div class="avatar-wrapper">
                                <img class="avatar no-frame" src="${anchorInfo.base_info?.face}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                            </div>
                            <div class="user-info">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span class="user-name">${anchorInfo.base_info?.uname || 'Unknown'}</span>
                                    ${liveBadge}
                                </div>
                                <span class="pub-time">直播间: ${roomInfo.room_id}</span>
                            </div>
                        </div>
                    </div>
                    <div class="title">${roomInfo.title}</div>
                    <div class="stats">
                        <span class="stat-item">${ICONS.fire} ${watched.text_large || watched.num || 0}</span>
                        <span class="stat-item">${ICONS.star} ${roomInfo.parent_area_name || ''} · ${roomInfo.area_name || ''}</span>
                    </div>
                </div>
            `;
        } 
        // ---------------- DYNAMIC / OPUS ----------------
        else if (type === 'dynamic') {
            // Updated structure access to match Python's full response
            let modules = {};
            let item = {};
            
            if (data.data.item) {
                item = data.data.item;
                modules = item.modules;
            } else {
                item = data.data;
                modules = item.modules || {};
            }

            const module_author = modules.module_author || {};
            const module_dynamic = modules.module_dynamic || {};
            const module_stat = modules.module_stat || {};

            const authorName = module_author.name || 'Unknown';
            const authorFace = module_author.face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';
            const pubTime = this.formatPubTime(data.data.pub_ts) || module_author.pub_time || '';

            // 获取作者装饰信息
            const pendant = module_author.pendant || {};
            const decorationCard = module_author.decoration_card || {};
            const fanInfo = decorationCard.fan || {};
            const authorInfo = item.author || data.data.author || {};
            const authorLevel = authorInfo.level || 0;
            // 更稳健的挂件与卡片获取
            const pendantUrl = authorInfo.pendant_url || (module_author.pendant && module_author.pendant.image) || '';
            const cardUrl = authorInfo.card_url || (decorationCard && decorationCard.card_url) || '';
            const accentColor = authorInfo.card_focus_color || '';
            const fanNumber = fanInfo.num_desc || '';
            const fanColor = authorInfo.fan_color || fanInfo.color || '#555';
            const serial = (fanNumber || authorInfo.card_number || null);
            const decorateObj = module_author.decorate || {};
            const decorateCardUrl = authorInfo.card_url || decorateObj.card_url || decorateObj.card_bg || (decorateObj.card && decorateObj.card.image) || '';
            
            let text = "";
            let title = "";
            let richTextNodes = null;

            // Handle DYNAMIC_TYPE_LIVE_RCMD
            let liveRcmdInfo = null;
            if (item.type === 'DYNAMIC_TYPE_LIVE_RCMD' && module_dynamic.major?.live_rcmd?.content) {
                try {
                    const contentStr = module_dynamic.major.live_rcmd.content;
                    const contentJson = JSON.parse(contentStr);
                    if (contentJson.live_play_info) {
                        liveRcmdInfo = contentJson.live_play_info;
                    }
                } catch (e) {
                    logger.error('Failed to parse live_rcmd content', e);
                }
            }

            if (module_dynamic.desc) {
                text = module_dynamic.desc.text || "";
                richTextNodes = module_dynamic.desc.rich_text_nodes;
            } else if (module_dynamic.major?.opus) {
                 if (module_dynamic.major.opus.summary) {
                     text = module_dynamic.major.opus.summary.text || "";
                     richTextNodes = module_dynamic.major.opus.summary.rich_text_nodes;
                 }
                 title = module_dynamic.major.opus.title || "";
            }
            
            // Process text with parseRichText
            text = parseRichText(richTextNodes, text);

            const voteObj = getVoteFromModules(modules);
            const voteHtml = renderVoteCard(voteObj);

            let images = [];
            let videoCard = null;

            if (module_dynamic.major?.draw?.items) {
                images = module_dynamic.major.draw.items.map(i => i.src);
            } else if (module_dynamic.major?.opus?.pics) {
                 images = module_dynamic.major.opus.pics.map(i => i.url);
            } else if (module_dynamic.major?.archive) {
                 // Video card embedded in dynamic
                 videoCard = module_dynamic.major.archive;
                 if(!text) text = videoCard.desc;
            } else if (liveRcmdInfo) {
                // Construct pseudo videoCard for live
                 const isLive = liveRcmdInfo.live_status === 1;
                 const liveBadge = isLive
                    ? `<span class="live-badge-status live-on">LIVE</span>`
                    : `<span class="live-badge-status live-off">OFFLINE</span>`;
                 
                 videoCard = {
                    cover: liveRcmdInfo.cover,
                    title: liveRcmdInfo.title,
                    isLiveRcmd: true,
                    liveBadge: liveBadge,
                    area: `${liveRcmdInfo.parent_area_name} · ${liveRcmdInfo.area_name}`,
                    watched: liveRcmdInfo.watched_show?.text_large || ''
                 };
            }

            // Construct Image HTML
            let mediaHtml = '';
            if (images.length === 1) {
                mediaHtml = `<img class="dynamic-image" src="${images[0]}" style="width: 100%; height: auto; margin-top: 20px;">`;
            } else if (images.length > 1) {
                mediaHtml = `
                    <div class="images-grid">
                        ${images.map(src => `<img src="${src}" style="width: 100%; height: 100%; object-fit: cover; aspect-ratio: 1/1; margin-top: 10px;">`).join('')}
                    </div>`;
            } else if (videoCard) {
                if (videoCard.isLiveRcmd) {
                     mediaHtml = `
                        <div style="margin-top:20px; border:1px solid #eee; border-radius:8px; overflow:hidden;">
                            <div class="cover-container">
                                <img src="${videoCard.cover}" style="width: 100%; aspect-ratio:16/9; object-fit: cover; max-height: 800px;">
                                ${videoCard.liveBadge ? `<div style="position:absolute; top:10px; right:10px;">${videoCard.liveBadge}</div>` : ''}
                            </div>
                            <div style="padding:15px; background:#f9f9f9;">
                                <div style="font-weight:bold; font-size:18px; margin-bottom:8px;">${videoCard.title}</div>
                                <div style="color:#666; font-size:14px; display:flex; gap:15px;">
                                    <span>${videoCard.area}</span>
                                    <span>${videoCard.watched}</span>
                                </div>
                            </div>
                        </div>
                    `;
                } else {
                    const duration = videoCard.duration_text || '';
                    const play = videoCard.stat?.play || '';
                    const danmaku = videoCard.stat?.danmaku || '';
                    mediaHtml = `
                        <div class="video-card-inline">
                            <div class="cover-container">
                                <img src="${videoCard.cover}" style="width: 100%; height: auto; display: block;">
                                ${duration ? `<span class="duration-badge">${duration}</span>` : ''}
                            </div>
                            <div class="video-card-content">
                                <div class="video-card-title">${videoCard.title}</div>
                                ${(play || danmaku) ? `
                                <div class="stat-inline-container">
                                    ${play ? `<span class="stat-inline">${ICONS.view} ${play}</span>` : ''}
                                    ${danmaku ? `<span class="stat-inline">${ICONS.comment} ${danmaku}</span>` : ''}
                                </div>
                                ` : ''}
                            </div>
                        </div>
                    `;
                }
            }

            let origHtml = '';
            if (item.orig) {
                const oitem = item.orig.item ? item.orig.item : item.orig;
                const omodules = oitem.modules || {};
                const o_author = omodules.module_author || {};
                const o_dynamic = omodules.module_dynamic || {};
                let o_text = "";
                let o_title = "";
                let o_richTextNodes = null;
                if (o_dynamic.desc) {
                    o_text = o_dynamic.desc.text || "";
                    o_richTextNodes = o_dynamic.desc.rich_text_nodes;
                } else if (o_dynamic.major?.opus) {
                    if (o_dynamic.major.opus.summary) {
                        o_text = o_dynamic.major.opus.summary.text || "";
                        o_richTextNodes = o_dynamic.major.opus.summary.rich_text_nodes;
                    }
                    o_title = o_dynamic.major.opus.title || "";
                }
                o_text = parseRichText(o_richTextNodes, o_text);
                let o_images = [];
                let o_videoCard = null;
                if (o_dynamic.major?.draw?.items) {
                    o_images = o_dynamic.major.draw.items.map(i => i.src);
                } else if (o_dynamic.major?.opus?.pics) {
                    o_images = o_dynamic.major.opus.pics.map(i => i.url);
                } else if (o_dynamic.major?.archive) {
                    o_videoCard = o_dynamic.major.archive;
                    if (!o_text) o_text = o_videoCard.desc;
                }
                let o_mediaHtml = '';
                if (o_images.length === 1) {
                    o_mediaHtml = `<img class="single-image" src="${o_images[0]}" style="width: 100%; height: auto; object-fit: contain; max-height: 1000px; margin-top: 10px;">`;
                } else if (o_images.length > 1) {
                    o_mediaHtml = `
                        <div class="images-grid" style="margin-top:10px;">
                            ${o_images.map(src => `<img src="${src}" style="width: 100%; height: 100%; object-fit: cover; aspect-ratio: 1/1;">`).join('')}
                        </div>`;
                } else if (o_videoCard) {
                    const duration = o_videoCard.duration_text || '';
                    const play = this.formatNumber(o_videoCard.stat?.play || o_videoCard.stat?.view);
                    const danmaku = this.formatNumber(o_videoCard.stat?.danmaku);
                    o_mediaHtml = `
                        <div class="video-card-inline">
                            <div class="cover-container">
                                <img src="${o_videoCard.cover}" style="width: 100%; aspect-ratio:16/9; object-fit: cover; max-height: 800px;">
                                ${duration ? `<span class="duration-badge">${duration}</span>` : ''}
                            </div>
                            <div class="video-card-content">
                                <div class="video-card-title">${o_videoCard.title}</div>
                                <div class="stat-inline-container">
                                    <span class="stat-inline">${ICONS.view} ${play}</span>
                                    <span class="stat-inline">${ICONS.comment} ${danmaku}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }
                const o_voteObj = getVoteFromModules(omodules);
                const o_voteHtml = renderVoteCard(o_voteObj);
                const o_name = o_author.name || 'Unknown';
                const o_face = o_author.face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';
                origHtml = `
                    <div class="orig-card">
                        <div class="orig-header">
                            <img class="orig-author-avatar" src="${o_face}">
                            <span class="orig-author-name">${o_name}</span>
                        </div>
                        <div class="orig-content">
                            ${o_title ? `<div class="orig-title">${o_title}</div>` : ''}
                            ${o_text ? `<div class="orig-text truncated">${o_text}</div>` : ''}
                            ${o_voteHtml}
                            ${o_mediaHtml}
                        </div>
                    </div>
                `;
            }

            htmlContent += `
                <div class="content">

                    <div class="header">
                        <div class="header-left">
                            <div class="avatar-wrapper">
                                <img class="avatar ${pendantUrl ? 'no-border' : 'no-frame'}" src="${authorFace}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                                ${pendantUrl ? `<img class="avatar-frame" src="${pendantUrl}" />` : ''}
                            </div>
                            <div class="user-info">
                                <span class="user-name">${authorName} ${authorLevel ? `<span class="user-level">Lv${authorLevel}</span>` : ''}</span>
                                <span class="pub-time">${pubTime}</span>
                            </div>
                        </div>
                        <div class="header-right" style="display:flex; align-items:center; gap:12px;">
                            ${cardUrl ? `
                                <div class="decoration-card-wrapper">
                                    <img class="decoration-card" src="${cardUrl}" />
                                    ${serial ? `<span class="serial-badge" style="color: ${fanColor};">No.${serial}</span>` : ''}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    ${title ? `<div class="title">${title}</div>` : ''}
                    <div class="text-content truncated">${text}</div>
                    ${voteHtml}
                    ${origHtml}
                    ${mediaHtml}
                    <div class="action-bar">
                         <div class="action-item">${ICONS.share} ${this.formatNumber(module_stat.forward?.count)}</div>
                         <div class="action-item">${ICONS.comment} ${this.formatNumber(module_stat.comment?.count)}</div>
                         <div class="action-item">${ICONS.like} ${this.formatNumber(module_stat.like?.count)}</div>
                    </div>
                </div>
            `;
        } 
        // ---------------- USER ----------------
        else if (type === 'user') {
            const info = data.data;
            const face = info.face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';
            const name = info.name || 'Unknown';
            const sign = info.sign || '';
            const pendant = info.pendant || {};
            const pendantImage = pendant.image || '';
            const follower = info.relation ? info.relation.follower : 0;
            const following = info.relation ? info.relation.following : 0;
            const level = info.level || 0;
            
            // VIP Info
            const isVip = info.vip && info.vip.status === 1; // 1 means active
            const vipLabel = info.vip && info.vip.label && info.vip.label.text ? info.vip.label.text : (isVip ? '大会员' : '');
            
            // Fan Medal
            const medalName = info.fans_medal && info.fans_medal.medal ? info.fans_medal.medal.medal_name : '';
            const medalLevel = info.fans_medal && info.fans_medal.medal ? info.fans_medal.medal.level : 0;

            // Latest Dynamic logic
            let dynamicHtml = '';
            if (info.dynamic) {
                const dyn = info.dynamic;
                const modules = dyn.modules || {};
                const dynDesc = modules.module_dynamic ? modules.module_dynamic.desc : null;
                const dynMajor = modules.module_dynamic ? modules.module_dynamic.major : null;
                
                let dynText = dynDesc ? dynDesc.text : '';
                
                // 尝试从 major 中获取文本 (针对 OPUS/DRAW 类型)
                if (!dynText && dynMajor) {
                    if (dynMajor.opus && dynMajor.opus.summary) {
                         dynText = dynMajor.opus.summary.text || (dynMajor.opus.summary.rich_text_nodes || []).map(n => n.text).join('');
                    } else if (dynMajor.draw && dynMajor.draw.items) {
                         // DRAW 类型通常文本在 desc 中，但有时也在其它位置，此处作为备用
                    }
                }
                
                let dynImages = [];
                let dynVideo = null;

                if (dynMajor) {
                    if (dynMajor.draw && dynMajor.draw.items) {
                        dynImages = dynMajor.draw.items.map(i => i.src);
                    } else if (dynMajor.opus && dynMajor.opus.pics) {
                        dynImages = dynMajor.opus.pics.map(i => i.url);
                    } else if (dynMajor.archive) {
                        dynVideo = dynMajor.archive;
                        if (!dynText) dynText = dynVideo.desc;
                    }
                }
                
                let mediaHtml = '';
                if (dynImages.length > 0) {
                     mediaHtml = `<div style="display: flex; gap: 12px; margin-top: 20px; overflow: hidden; height: 180px;">
                        ${dynImages.slice(0, 3).map(src => `<img src="${src}" style="height: 180px; width: 180px; object-fit: cover; border-radius: 8px;">`).join('')}
                     </div>`;
                } else if (dynVideo) {
                     mediaHtml = `<div style="margin-top: 20px; display: flex; gap: 16px; background: var(--color-soft-bg); border-radius: 12px; padding: 12px; align-items: center;">
                        <img src="${dynVideo.cover}" style="height: 90px; width: 144px; object-fit: cover; border-radius: 8px;">
                        <div style="flex: 1; font-size: 20px; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.4;">${dynVideo.title}</div>
                     </div>`;
                }

                dynamicHtml = `
                    <div style="margin-top: 35px; border-top: 1px solid var(--color-border); padding-top: 25px; text-align: left;">
                        <div style="font-size: 20px; color: var(--color-subtext); margin-bottom: 12px; font-weight: bold;">最近动态</div>
                        <div style="font-size: 24px; color: var(--color-text); line-height: 1.6; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;">${dynText}</div>
                        ${mediaHtml}
                    </div>
                `;
            }

            htmlContent += `
                <div class="content">
                    <div class="header" style="display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 10px;">
                        <div class="avatar-wrapper" style="width: 150px; height: 150px; margin-bottom: 20px; box-sizing: content-box; ${pendantImage ? 'padding-top: 85px;' : ''}">
                            <img class="avatar ${pendantImage ? '' : 'no-frame'}" src="${face}" style="width: 150px; height: 150px; border-width: 4px;">
                            ${pendantImage ? `<img class="avatar-frame" src="${pendantImage}" style="width: 160%; height: 160%;">` : ''}
                        </div>
                        <div class="user-info" style="width: 100%;">
                            <div class="user-name" style="font-size: 36px; font-weight: bold; color: var(--color-text); display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap;">
                                ${name}
                                <span class="user-level" style="font-size: 16px; background: var(--color-primary); color: white; padding: 4px 8px; border-radius: 4px; vertical-align: middle;">Lv${level}</span>
                                ${vipLabel ? `<span style="font-size: 16px; background: var(--color-primary); color: white; padding: 4px 8px; border-radius: 4px; vertical-align: middle;">${vipLabel}</span>` : ''}
                            </div>
                            ${show_id ? `<div style="text-align: center; font-size: 16px; color: var(--color-subtext); margin-top: 4px; font-family: monospace;">UID: ${info.uid}</div>` : ''}
                            ${medalName ? `
                            <div style="margin-top: 12px; display: flex; align-items: center; justify-content: center;">
                                <div style="display: inline-flex; border: 1px solid var(--color-subtext); border-radius: 4px; overflow: hidden;">
                                    <span style="background: var(--color-subtext); color: var(--color-card-bg); padding: 2px 6px; font-size: 16px; font-weight: bold;">${medalName}</span>
                                    <span style="background: var(--color-card-bg); color: var(--color-subtext); padding: 2px 6px; font-size: 16px;">${medalLevel}</span>
                                </div>
                            </div>` : ''}
                            ${sign ? `<div class="text-content" style="text-align: center; margin-top: 16px; color: var(--color-subtext); font-size: 18px; line-height: 1.5; padding: 0 20px;">"${sign}"</div>` : ''}
                        </div>
                    </div>

                    <div class="stats" style="display: flex; justify-content: center; gap: 40px; margin: 30px auto 0 auto; padding: 20px 40px; background: var(--color-soft-bg); border-radius: 12px; width: fit-content;">
                        <div style="text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: var(--color-text); margin-bottom: 4px;">${this.formatNumber(follower)}</div>
                            <div style="font-size: 16px; color: var(--color-subtext);">粉丝</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: var(--color-text); margin-bottom: 4px;">${this.formatNumber(following)}</div>
                            <div style="font-size: 16px; color: var(--color-subtext);">关注</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: var(--color-text); margin-bottom: 4px;">${this.formatNumber(info.likes || 0)}</div>
                            <div style="font-size: 16px; color: var(--color-subtext);">获赞</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 24px; font-weight: bold; color: var(--color-text); margin-bottom: 4px;">${this.formatNumber(info.archive_view || 0)}</div>
                            <div style="font-size: 16px; color: var(--color-subtext);">播放</div>
                        </div>
                    </div>
                    ${dynamicHtml}
                </div>
            `;
        }

        htmlContent += `</div></div></body></html>`;

        await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 0 });
        await page.waitForSelector('.container', { timeout: 5000 });
        await page.waitForTimeout(300);
        const container = await page.$('.container');
        const buffer = await container.screenshot({
            type: 'png',
            omitBackground: true
        });

        await page.close();

        return buffer.toString('base64');
    }

    async generateSubscriptionList(data, groupId, show_id = true) {
        await this.init();
        const page = await this.browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 设置视口以提高清晰度
        await page.setViewport({
            width: 880,
            height: 1000,
            deviceScaleFactor: 2
        });

        const isNight = this.isNightMode(groupId);
        const themeClass = isNight ? 'theme-dark' : 'theme-light';
        
        const html = `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                :root {
                    --bg-gradient: linear-gradient(135deg, #fef5f6 0%, #e8f5ff 50%, #f0f9ff 100%);
                    --card-bg: #fff;
                    --card-border: rgba(255, 255, 255, 0.9);
                    --text-title: #333;
                    --text-subtitle: #999;
                    --border-color: #e3e5e7;
                    --primary-color: #00AEEC;
                    --accent-color: #FB7299;
                    --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
                    --text-main: #18191c;
                }
                .theme-dark {
                    --bg-gradient: linear-gradient(135deg, #1a1a1a 0%, #2c3e50 100%);
                    --card-bg: #171B21;
                    --card-border: rgba(255, 255, 255, 0.08);
                    --text-title: #E8EAED;
                    --text-subtitle: #A8ADB4;
                    --border-color: #3d3d3d;
                    --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2);
                    --text-main: #e0e0e0;
                }
                body {
                    margin: 0;
                    padding: 0;
                    background: transparent;
                    font-family: "MiSans", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
                }
                #wrapper {
                    padding: 40px;
                    background: var(--bg-gradient);
                    border-radius: 20px;
                    width: 800px;
                    overflow: hidden;
                }
                .container {
                    background: var(--card-bg);
                    border-radius: 20px;
                    box-shadow: var(--shadow-card);
                    border: 1px solid var(--card-border);
                    padding: 28px;
                    overflow: hidden;
                }
                .header {
                    text-align: center;
                    margin-bottom: 28px;
                    border-bottom: 2px solid var(--border-color);
                    padding-bottom: 20px;
                }
                .header h1 {
                    margin: 0;
                    font-size: 32px;
                    background: linear-gradient(135deg, #FB7299, #FF6699);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    font-weight: 800;
                    letter-spacing: 1px;
                }
                .section {
                    margin-bottom: 28px;
                }
                .section-title {
                    font-size: 20px;
                    font-weight: 700;
                    color: var(--text-title);
                    margin-bottom: 16px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .section-title::before {
                    content: '';
                    display: block;
                    width: 5px;
                    height: 20px;
                    background: linear-gradient(135deg, #00A1D6, #00B5E5);
                    border-radius: 3px;
                    box-shadow: 0 2px 8px rgba(0, 161, 214, 0.3);
                }
                .count-badge {
                    background: var(--primary-color);
                    color: white;
                    font-size: 12px;
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-weight: bold;
                }
                .user-list {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 16px;
                }
                .user-card {
                    display: flex;
                    align-items: center;
                    padding: 12px;
                    background-color: ${isNight ? 'rgba(255,255,255,0.05)' : '#f9f9f9'};
                    border-radius: 12px;
                    border: 1px solid var(--border-color);
                    transition: all 0.2s;
                }
                .avatar-container {
                    position: relative;
                    width: 60px;
                    height: 60px;
                    margin-right: 16px;
                    flex-shrink: 0;
                }
                .avatar {
                    width: 60px;
                    height: 60px;
                    border-radius: 50%;
                    object-fit: cover;
                    border: 2px solid var(--card-bg);
                    box-shadow: 0 2px 6px rgba(0,0,0,0.1);
                }
                .user-info {
                    flex: 1;
                    min-width: 0;
                }
                .user-name-row {
                    display: flex;
                    align-items: center;
                    margin-bottom: 4px;
                }
                .user-name {
                    font-size: 16px;
                    font-weight: bold;
                    color: var(--text-main);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    margin-right: 8px;
                }
                .level-badge {
                    font-size: 10px;
                    padding: 0 4px;
                    border-radius: 2px;
                    background-color: #ddd;
                    color: #666;
                    font-weight: bold;
                }
                .level-badge.lv0 { background-color: #bfbfbf; color: #fff; }
                .level-badge.lv1 { background-color: #bfbfbf; color: #fff; }
                .level-badge.lv2 { background-color: #95ddb2; color: #fff; }
                .level-badge.lv3 { background-color: #92d1e5; color: #fff; }
                .level-badge.lv4 { background-color: #ffb37c; color: #fff; }
                .level-badge.lv5 { background-color: #ff6c00; color: #fff; }
                .level-badge.lv6 { background-color: #ff0000; color: #fff; }
                
                .user-details {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    font-size: 12px;
                    color: var(--text-subtitle);
                    align-items: center;
                }
                .uid {
                    font-family: monospace;
                    opacity: 0.8;
                }

                .bangumi-list {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 12px;
                }
                .bangumi-card {
                    padding: 12px;
                    background-color: ${isNight ? 'rgba(255,255,255,0.05)' : '#f9f9f9'};
                    border-radius: 12px;
                    border: 1px solid var(--border-color);
                    display: flex;
                    align-items: center;
                }
                .bangumi-icon {
                    margin-right: 8px;
                    font-size: 20px;
                }
                .bangumi-title {
                    font-size: 14px;
                    font-weight: 500;
                    color: var(--text-main);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                
                .empty-tip {
                    text-align: center;
                    color: var(--text-subtitle);
                    padding: 20px;
                    font-style: italic;
                    background: rgba(0,0,0,0.02);
                    border-radius: 8px;
                }
            </style>
        </head>
        <body class="${themeClass}">
            <div id="wrapper">
                <div class="container">
                <div class="header">
                    <h1>订阅列表</h1>
                </div>

                <div class="section">
                    <div class="section-title">
                        用户订阅
                        <span class="count-badge">${data.users.length}</span>
                    </div>
                    ${data.users.length > 0 ? `
                        <div class="user-list">
                            ${data.users.map(u => {
                                return `
                                <div class="user-card">
                                    <div class="avatar-container">
                                        <img src="${u.face}" class="avatar" crossorigin="anonymous">
                                    </div>
                                    <div class="user-info">
                                        <div class="user-name-row">
                                            <span class="user-name">${u.name}</span>
                                            <span class="level-badge lv${u.level}">LV${u.level}</span>
                                        </div>
                                        <div class="user-details">
                                            ${show_id ? `<span class="uid">UID:${u.uid}</span>` : ''}
                                        </div>
                                    </div>
                                </div>
                                `;
                            }).join('')}
                        </div>
                    ` : '<div class="empty-tip">暂无用户订阅</div>'}
                </div>

                <div class="section">
                    <div class="section-title">
                        番剧订阅
                        <span class="count-badge">${data.bangumis.length}</span>
                    </div>
                    ${data.bangumis.length > 0 ? `
                        <div class="bangumi-list">
                            ${data.bangumis.map(b => `
                                <div class="bangumi-card">
                                    <span class="bangumi-icon">📺</span>
                                    <span class="bangumi-title">${b.title}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<div class="empty-tip">暂无番剧订阅</div>'}
                </div>
            </div>
            </div>
        </body>
        </html>`;

        await page.setContent(html);
        const wrapper = await page.$('#wrapper');
        const buffer = await wrapper.screenshot({
            type: 'webp',
            quality: 80,
            omitBackground: true
        });

        await page.close();
        return buffer.toString('base64');
    }

    // 辅助函数：调整颜色亮度
    adjustBrightness(hex, percent) {
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

    // 辅助函数：将 hex 颜色转换为 rgba
    hexToRgba(hex, alpha) {
        // 移除 # 号
        hex = hex.replace('#', '');

        // 转换为 RGB
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    async generateHelpCard(type = 'user', groupId) {
        await this.init();
        const page = await this.browser.newPage();

        // 设置高质量视口
        await page.setViewport({
            width: 1000,
            height: 1500,
            deviceScaleFactor: 1.5  // 提高到2以获得视网膜屏清晰度
        });

        // Theme: auto switch by config
        const isNight = this.isNightMode(groupId);
        const themeClass = isNight ? 'theme-dark' : 'theme-light';

        const style = `
            <style>
                :root {
                    --bg-gradient: linear-gradient(135deg, #fef5f6 0%, #e8f5ff 50%, #f0f9ff 100%);
                    --card-bg: #fff;
                    --card-border: rgba(255, 255, 255, 0.9);
                    --text-title: #333;
                    --text-subtitle: #999;
                    --link-bg: linear-gradient(135deg, #f8f9fa 0%, #f4f6f8 100%);
                    --link-text: #555;
                    --cmd-item-bg: #fff;
                    --cmd-item-border: #f0f0f0;
                    --cmd-code-bg: linear-gradient(135deg, #FFF0F6, #FFE8F0);
                    --cmd-code-color: #FB7299;
                    --cmd-desc: #666;
                    --footer-text: #bbb;
                    --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
                }

                .theme-dark {
                    --bg-gradient: linear-gradient(135deg, #1a1a1a 0%, #2c3e50 100%);
                    --card-bg: #171B21;
                    --card-border: rgba(255, 255, 255, 0.08);
                    --text-title: #E8EAED;
                    --text-subtitle: #A8ADB4;
                    --link-bg: #12161B;
                    --link-text: #A8ADB4;
                    --cmd-item-bg: #12161B;
                    --cmd-item-border: rgba(255, 255, 255, 0.08);
                    --cmd-code-bg: rgba(251, 114, 153, 0.15);
                    --cmd-code-color: #FF6699;
                    --cmd-desc: #888;
                    --footer-text: #666;
                    --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2);
                }

                body {
                    margin: 0;
                    padding: 0;
                    background: transparent;
                    width: 1000px;
                    font-family: "MiSans", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                }

                .container {
                    padding: 24px;
                    background: var(--bg-gradient);
                    box-sizing: border-box;
                    width: 100%;
                    display: inline-block;
                }

                .card {
                    background: var(--card-bg);
                    border-radius: 20px;
                    overflow: hidden;
                    box-shadow: var(--shadow-card);
                    border: 1px solid var(--card-border);
                    padding: 28px;
                }

                .header {
                    text-align: center;
                    margin-bottom: 28px;
                    border-bottom: 2px solid var(--cmd-item-border);
                    padding-bottom: 20px;
                }

                .title {
                    font-size: 36px;
                    font-weight: 800;
                    background: linear-gradient(135deg, #FB7299, #FF6699);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                    margin-bottom: 8px;
                    letter-spacing: 1px;
                }

                .subtitle {
                    font-size: 22px;
                    color: var(--text-subtitle);
                    font-weight: 500;
                }

                .section {
                    margin-bottom: 28px;
                }

                .section-title {
                    font-size: 26px;
                    font-weight: 700;
                    color: var(--text-title);
                    margin-bottom: 16px;
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

                .link-list {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 12px;
                }

                .link-item {
                    background: var(--link-bg);
                    padding: 12px 16px;
                    border-radius: 12px;
                    font-size: 20px;
                    color: var(--link-text);
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    transition: all 0.2s;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
                    font-weight: 500;
                }

                .icon {
                    font-size: 26px;
                }

                .cmd-list {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .cmd-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: var(--cmd-item-bg);
                    border: 2px solid var(--cmd-item-border);
                    padding: 14px 18px;
                    border-radius: 12px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
                }

                .cmd-code {
                    font-family: 'Consolas', 'Monaco', monospace;
                    font-weight: bold;
                    color: var(--cmd-code-color);
                    background: var(--cmd-code-bg);
                    padding: 6px 12px;
                    border-radius: 8px;
                    font-size: 20px;
                }

                .cmd-desc {
                    font-size: 18px;
                    color: var(--cmd-desc);
                    font-weight: 500;
                }

                .cmd-tag {
                    font-size: 12px;
                    padding: 2px 6px;
                    border-radius: 4px;
                    margin-left: 8px;
                    vertical-align: middle;
                    font-weight: 600;
                    letter-spacing: 0.5px;
                    border: 1px solid transparent;
                    background: transparent;
                }

                .tag-root {
                    color: #FF6666;
                    border-color: rgba(255, 100, 100, 0.4);
                }

                .tag-admin {
                    color: #44AAFF;
                    border-color: rgba(68, 170, 255, 0.4);
                }

                .theme-dark .tag-root {
                    color: #FF8888;
                    border-color: rgba(255, 136, 136, 0.4);
                }
                
                .theme-dark .tag-admin {
                    color: #88DDFF;
                    border-color: rgba(136, 221, 255, 0.4);
                }

                .footer {
                    text-align: center;
                    font-size: 16px;
                    color: var(--footer-text);
                    margin-top: 12px;
                    font-weight: 400;
                }
            </style>
        `;

        let contentHtml = '';
        let title = 'Bilibili Assistant';
        let subtitle = '全能 B 站链接解析 & 订阅助手';

        if (type === 'user') {
            contentHtml = `
                <div class="section">
                    <div class="section-title">用户指令</div>
                    <div class="cmd-list">
                        <div class="cmd-item">
                            <span class="cmd-code">/订阅列表</span>
                            <span class="cmd-desc">查看本群分类订阅列表</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">/清理上下文</span>
                            <span class="cmd-desc">清理当前群组的 AI 对话记忆</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">@Bot &lt;内容&gt;</span>
                            <span class="cmd-desc">与 AI 进行对话</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">/菜单</span>
                            <span class="cmd-desc">显示此菜单</span>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">管理指令<span class="cmd-tag tag-admin">群管</span></div>
                    <div class="cmd-list">
                        <div class="cmd-item">
                            <span class="cmd-code">/查询订阅 &lt;uid&gt;</span>
                            <span class="cmd-desc">立即检查某用户动态</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">/订阅用户 &lt;uid&gt;</span>
                            <span class="cmd-desc">订阅用户（动态+直播）</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">/取消订阅用户 &lt;uid&gt;</span>
                            <span class="cmd-desc">取消用户订阅</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">/订阅番剧 &lt;season_id&gt;</span>
                            <span class="cmd-desc">订阅番剧新剧集更新</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">/取消订阅番剧 &lt;season_id&gt;</span>
                            <span class="cmd-desc">取消番剧订阅</span>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">支持解析</div>
                    <div class="link-list">
                        <div class="link-item"><span class="icon">📺</span> 视频 (BV/av)</div>
                        <div class="link-item"><span class="icon">🎬</span> 番剧 (ss/ep)</div>
                        <div class="link-item"><span class="icon">📰</span> 专栏文章 (cv)</div>
                        <div class="link-item"><span class="icon">📡</span> 直播间 (live)</div>
                        <div class="link-item"><span class="icon">📱</span> 动态 (dynamic)</div>
                        <div class="link-item"><span class="icon">🖼️</span> Opus图文</div>
                        <div class="link-item"><span class="icon">🔗</span> 短链 (b23.tv)</div>
                        <div class="link-item"><span class="icon">📦</span> 小程序分享</div>
                    </div>
                </div>
                
                <div class="footer" style="margin-top: 20px; font-weight: bold; color: var(--text-subtitle); display: flex; flex-direction: column; align-items: center; gap: 8px;">
                    <div>管理员请发送 <span style="font-family: monospace; background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 4px;">/设置 帮助</span> 查看管理面板</div>
                </div>
            `;
        } else if (type === 'admin') {
            title = '管理面板';
            subtitle = '系统配置与权限管理';
            contentHtml = `
                <div class="section">
                    <div class="section-title">管理员菜单<span class="cmd-tag tag-admin">群管</span></div>
                    <div class="cmd-list">
                        <div class="cmd-item">
                            <span class="cmd-code">/查询订阅 &lt;uid&gt;</span>
                            <span class="cmd-desc">检查动态更新</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">/设置 功能 &lt;开|关&gt;</span>
                            <span class="cmd-desc">开关Bot权限</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">/设置 黑名单 &lt;操作&gt;</span>
                            <span class="cmd-desc">管理黑名单</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">/设置 标签 &lt;操作&gt;</span>
                            <span class="cmd-desc">设置解析标签</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">/设置 深色模式</span>
                            <span class="cmd-desc">配置深色模式</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">/设置 缓存 &lt;秒数&gt;</span>
                            <span class="cmd-desc">设置解析缓存</span>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">系统菜单<span class="cmd-tag tag-root">Root</span></div>
                    <div class="cmd-list">
                        <div class="cmd-item">
                            <span class="cmd-code">/设置 登录</span>
                            <span class="cmd-desc">获取登录二维码</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">/设置 验证 &lt;key&gt;</span>
                            <span class="cmd-desc">验证登录状态</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">/设置 轮询 &lt;秒数&gt;</span>
                            <span class="cmd-desc">设置轮询间隔</span>
                        </div>
                        <div class="cmd-item">
                            <span class="cmd-code">/设置 管理员 &lt;添加|移除&gt;</span>
                            <span class="cmd-desc">设置本群管理员</span>
                        </div>
                    </div>
                </div>
            `;
        }

        const html = `<html><head>${style}</head><body>
            <div class="container ${themeClass}">
                <div class="card">
                    <div class="header">
                        <div class="title">${title}</div>
                        <div class="subtitle">${subtitle}</div>
                    </div>
                    
                    ${contentHtml}
                    
                    <div class="footer" style="display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        <div style="font-size: 14px; opacity: 0.8; font-weight: normal;">输入指令（不带参数）即可获取指令帮助</div>
                        <div>由 NapCat & Puppeteer 驱动</div>
                    </div>
                </div>
            </div>
        </body></html>`;

        await page.setContent(html);
        const container = await page.$('.container');
        const buffer = await container.screenshot({
            type: 'webp',
            quality: 80,  // 使用 WebP 压缩体积
            omitBackground: false
        });

        await page.close();

        return buffer.toString('base64');
    }

    formatPubTime(timestamp) {
        if (!timestamp) return '';
        const now = new Date();
        const date = new Date(timestamp * 1000);
        
        // 校验日期是否有效
        if (isNaN(date.getTime())) {
             // 尝试直接解析字符串 (兼容 "YYYY-MM-DD HH:mm:ss" 或其他格式)
             const tryDate = new Date(timestamp);
             if (!isNaN(tryDate.getTime())) {
                 return this.formatPubTime(tryDate.getTime() / 1000);
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

    formatNumber(num) {
        if (!num) return '0';
        if (num >= 100000000) {
            return (num / 100000000).toFixed(2) + '亿';
        }
        if (num >= 10000) {
            return (num / 10000).toFixed(1) + '万';
        }
        return num.toString();
    }
}

module.exports = new ImageGenerator();
