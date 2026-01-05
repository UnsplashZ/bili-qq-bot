const puppeteer = require('puppeteer');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

// SVG Icons (Unified Style - Material Designish)
const ICONS = {
    view: '<svg viewBox="0 0 24 24" width="16" height="16" fill="#999"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>',
    like: '<svg viewBox="0 0 24 24" width="16" height="16" fill="#999"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1.91l-.01-.01L23 10z"/></svg>',
    comment: '<svg viewBox="0 0 24 24" width="16" height="16" fill="#999"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>',
    fire: '<svg viewBox="0 0 24 24" width="16" height="16" fill="#999"><path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="16" height="16" fill="#999"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="16" height="16" fill="#999"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="16" height="16" fill="#999"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c0 .24-.04.47-.09.7l7.05 4.11c.54-.5 1.25-.81 2.04-.81 1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3z"/></svg>',
    globe: '<svg viewBox="0 0 24 24" width="16" height="16" fill="#999"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>'
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

    async generatePreviewCard(data, type) {
        await this.init();
        const page = await this.browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // 根据内容类型动态决定宽度
        let baseWidth = 900;

        // 对于动态类型，分析内容决定宽度
        if (type === 'dynamic') {
            const modules = data.data?.item?.modules || data.data?.modules || {};
            const module_dynamic = modules.module_dynamic || {};

            // 检查是否有图片或视频
            const hasImages = module_dynamic.major?.draw?.items?.length > 0 ||
                            module_dynamic.major?.opus?.pics?.length > 0;
            const hasVideo = !!module_dynamic.major?.archive;
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
            baseWidth = 1000;
        } else if (type === 'user') {
            baseWidth = 900;
        }

        // 设置高质量视口以保证清晰度
        await page.setViewport({
            width: baseWidth,
            height: 1200,  // 增加高度以容纳更多内容
            deviceScaleFactor: 1.5  // 提高到2以获得视网膜屏清晰度
        });

        // Type Config (Label & Color)
        const TYPE_CONFIG = {
            video: { label: '视频', color: '#FB7299', icon: '📺' },
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

        // 现代化美化的 CSS 样式
        const style = `
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    background: transparent;
                    width: ${baseWidth}px;
                    font-family: "MiSans", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                }

                .container {
                    padding: 28px;
                    background: linear-gradient(135deg, #fef5f6 0%, #e8f5ff 50%, #f0f9ff 100%);
                    box-sizing: border-box;
                    width: 100%;
                    min-height: 300px;
                    display: inline-block;
                }

                .card {
                    position: relative;
                    background: #ffffff;
                    border-radius: 24px;
                    overflow: hidden;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
                    border: 1px solid rgba(255, 255, 255, 0.9);
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }

                /* Type Badge - 更现代的设计 - 放大版 */
                .type-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 24px;
                    margin-left: 6px;
                    background: linear-gradient(135deg, ${currentType.color}, ${this.adjustBrightness(currentType.color, -10)});
                    color: white;
                    padding: 20px 40px;
                    border-radius: 24px;
                    font-size: 36px;
                    font-weight: 700;
                    box-shadow: 0 8px 24px ${this.hexToRgba(currentType.color, 0.4)}, 0 4px 12px rgba(0, 0, 0, 0.15);
                    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                    letter-spacing: 1px;
                }

                .cover-container { position: relative; width: 100%; }
                .cover { width: 100%; display: block; object-fit: cover; }
                .cover.video { aspect-ratio: 16/9; }
                .cover.bangumi { aspect-ratio: 3/4; object-fit: cover; }
                .cover.live { aspect-ratio: 16/9; }
                .cover.article { aspect-ratio: 21/9; }

                .content {
                    padding: 28px;
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
                    width: 112px;
                    height: 112px;
                    margin-right: 18px;
                }

                .avatar {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    width: 60px;
                    height: 60px;
                    transform: translate(-50%, -50%);
                    border-radius: 50%;
                    border: 3px solid #fff;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
                    z-index: 1;
                }

                .avatar.no-frame {
                    width: 80px;
                    height: 80px;
                }

                .avatar.no-border { border: none; }

                .avatar-frame {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    width: 112px;
                    height: 112px;
                    transform: translate(-50%, -50%);
                    object-fit: contain;
                    pointer-events: none;
                    z-index: 2;
                    filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.1));
                }

                .user-info {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .user-name {
                    font-size: 32px;
                    font-weight: 700;
                    color: #18191c;
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
                    border-radius: 10px;
                    font-weight: 700;
                    box-shadow: 0 2px 8px rgba(255, 179, 0, 0.3);
                }

                .pub-time {
                    font-size: 22px;
                    color: #999;
                    font-weight: 400;
                }

                .decoration-card-wrapper {
                    position: relative;
                    display: inline-block;
                }

                .decoration-card {
                    height: 112px;
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
                    background: rgba(255, 255, 255, 0.95);
                    padding: 8px 12px;
                    border-radius: 12px;
                    font-weight: 700;
                    font-size: 20px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    backdrop-filter: blur(8px);
                }

                .decorate-bg {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 140px;
                    border-radius: 20px 20px 0 0;
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
                    height: 140px;
                    border-radius: 20px 20px 0 0;
                    background: linear-gradient(to bottom, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0));
                }

                .title {
                    font-size: 36px;
                    font-weight: 700;
                    margin-bottom: 16px;
                    color: #18191c;
                    line-height: 1.5;
                    letter-spacing: 0.5px;
                }

                .text-content {
                    font-size: 26px;
                    color: #333;
                    line-height: 1.75;
                    margin-top: 20px;
                    margin-bottom: 18px;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                    text-align: justify;
                }
                .orig-card {
                    margin-top: 16px;
                    border: 2px solid #f0f0f0;
                    background: linear-gradient(135deg, #fafbfc 0%, #f7f9fb 100%);
                    border-radius: 16px;
                    overflow: hidden;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
                }

                .orig-header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 16px;
                    border-bottom: 2px solid #f0f0f0;
                    background: rgba(255, 255, 255, 0.6);
                }

                .orig-author-avatar {
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                }

                .orig-author-name {
                    font-weight: 700;
                    font-size: 20px;
                    color: #333;
                }

                .orig-content { padding: 16px; }

                .orig-title {
                    font-size: 22px;
                    font-weight: 700;
                    color: #18191c;
                    margin-bottom: 10px;
                    line-height: 1.4;
                }

                .orig-text {
                    font-size: 20px;
                    color: #555;
                    line-height: 1.7;
                    white-space: pre-wrap;
                }

                .stats {
                    display: flex;
                    gap: 28px;
                    font-size: 24px;
                    color: #8a8f99;
                    align-items: center;
                    margin-bottom: 12px;
                    background: linear-gradient(135deg, #f8f9fa 0%, #f4f6f8 100%);
                    padding: 16px 20px;
                    border-radius: 14px;
                    width: fit-content;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
                }

                .stat-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    font-weight: 600;
                    color: #666;
                }

                .stat-item svg {
                    fill: #8a8f99;
                    width: 28px;
                    height: 28px;
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
                    border-radius: 14px;
                    cursor: pointer;
                    transition: transform 0.2s;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
                }

                .single-image {
                    margin-top: 20px;
                    width: 100%;
                    max-height: 500px;
                    object-fit: contain;
                    border-radius: 18px;
                    display: block;
                    height: auto;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
                }

                .dynamic-image {
                    margin-top: 24px;
                    width: 100%;
                    height: auto;
                    object-fit: contain;
                    border-radius: 18px;
                    display: block;
                    max-height: 900px;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
                }

                .live-badge-status {
                    display: inline-block;
                    padding: 4px 12px;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 700;
                    margin-left: 10px;
                    vertical-align: middle;
                    transform: translateY(-1px);
                }

                .live-on {
                    background: linear-gradient(135deg, #FF6699, #FF4477);
                    color: white;
                    box-shadow: 0 2px 8px rgba(255, 102, 153, 0.4);
                }

                .live-off {
                    background: #e7e7e7;
                    color: #999;
                }

                .video-tag {
                    background: #f6f7f8;
                    color: #666;
                    padding: 4px 10px;
                    border-radius: 6px;
                    font-size: 14px;
                    margin-right: 8px;
                    vertical-align: middle;
                    font-weight: 500;
                }
            </style>
        `;

        let htmlContent = `<html><head>${style}</head><body>
            <div class="container">
                <div class="type-badge">
                    <span>${currentType.icon}</span>
                    <span>${currentType.label}</span>
                </div>
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
                                <span class="pub-time">${new Date(info.pubdate * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}${durationStr}</span>
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

            // For bangumi, we might have duration per episode in new_ep or other fields
            const durationStr = info.new_ep?.duration ? ` • 时长: ${formatDuration(info.new_ep.duration)}` : '';

            // Format styles (genres)
            const stylesStr = info.styles && info.styles.length > 0 ? ` | 风格: ${info.styles.slice(0, 3).join(', ')}` : '';

            // Format areas (regions)
            const areasStr = info.areas && info.areas.length > 0 ? ` | 地区: ${info.areas.map(area => area.name).slice(0, 2).join(', ')}` : '';

            // Format publish status
            const isPublished = info.publish?.is_started ? '已开播' : '未开播';
            const publishStatus = ` | 状态: ${isPublished}`;

            // Format episode info
            const episodeInfo = info.new_ep?.index_show || info.series?.series_name || '';

            htmlContent += `
                <div class="cover-container">
                    <img class="cover bangumi" src="${info.cover}" />
                </div>
                <div class="content">
                    <div class="title">${info.title}</div>
                    <div style="margin-top: 8px; margin-bottom: 12px; font-size: 18px; color: #666; display: flex; flex-wrap: wrap; gap: 15px;">
                        <span>开播: ${info.publish?.pub_time_show || info.publish?.release_date_show || '未知'}</span>
                        <span>${info.publish?.is_finish ? '已完结' : '连载中'}</span>
                        <span>更新: ${info.new_ep?.desc || '未知'}</span>
                    </div>
                    <div class="stats">
                        <span class="stat-item">${ICONS.view} ${this.formatNumber(info.stat?.views)}</span>
                        <span class="stat-item">${ICONS.heart} ${this.formatNumber(info.stat?.follow)}</span>
                        <span class="stat-item">${ICONS.comment} ${this.formatNumber(info.stat?.danmakus)}</span>
                        <span class="stat-item">${ICONS.star} ${info.rating?.score || 'N/A'}分</span>
                        <span class="stat-item">${ICONS.globe} ${info.areas && info.areas.length > 0 ? info.areas.map(area => area.name).slice(0, 2).join(', ') : '未知'}</span>
                    </div>
                    <div class="text-content">${info.desc || ''}</div>
                </div>
            `;
        } 
        // ---------------- ARTICLE ----------------
        else if (type === 'article') {
            const info = data.data;
            const cover = info.banner_url || (info.image_urls && info.image_urls.length > 0 ? info.image_urls[0] : '');
            const pubDate = info.publish_time ? new Date(info.publish_time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '';
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
                    <div class="stats">
                        <span class="stat-item">${ICONS.view} ${this.formatNumber(info.stats?.view)}</span>
                        <span class="stat-item">${ICONS.like} ${this.formatNumber(info.stats?.like)}</span>
                        <span class="stat-item">${ICONS.comment} ${this.formatNumber(info.stats?.reply)}</span>
                    </div>
                    <div class="text-content">${info.summary || ''}</div>
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
            const pubTime = module_author.pub_time || '';

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

            if (module_dynamic.desc) {
                text = module_dynamic.desc.text || "";
            } else if (module_dynamic.major?.opus) {
                 if (module_dynamic.major.opus.summary?.text) {
                     text = module_dynamic.major.opus.summary.text;
                 } else if (module_dynamic.major.opus.summary?.rich_text_nodes) {
                     text = module_dynamic.major.opus.summary.rich_text_nodes.map(n => n.text).join('');
                 } else {
                     text = "";
                 }
                 title = module_dynamic.major.opus.title || "";
            }

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
            }

            // Construct Image HTML
            let mediaHtml = '';
            if (images.length === 1) {
                mediaHtml = `<img class="dynamic-image" src="${images[0]}" style="width: 100%; height: auto; object-fit: contain; max-height: 1200px; margin-top: 20px;">`;
            } else if (images.length > 1) {
                mediaHtml = `
                    <div class="images-grid">
                        ${images.map(src => `<img src="${src}" style="width: 100%; height: 100%; object-fit: cover; aspect-ratio: 1/1; margin-top: 10px;">`).join('')}
                    </div>`;
            } else if (videoCard) {
                mediaHtml = `
                    <div style="margin-top:20px; border:1px solid #eee; border-radius:8px; overflow:hidden;">
                        <img src="${videoCard.cover}" style="width: 100%; aspect-ratio:16/9; object-fit: cover; max-height: 800px;">
                        <div style="padding:10px; background:#f9f9f9;">
                            <div style="font-weight:bold; font-size:14px;">${videoCard.title}</div>
                        </div>
                    </div>
                `;
            }

            // Determine media presence
            const hasMedia = (images && images.length > 0) || !!videoCard;

            let origHtml = '';
            if (item.orig) {
                const oitem = item.orig.item ? item.orig.item : item.orig;
                const omodules = oitem.modules || {};
                const o_author = omodules.module_author || {};
                const o_dynamic = omodules.module_dynamic || {};
                let o_text = "";
                let o_title = "";
                if (o_dynamic.desc) {
                    o_text = o_dynamic.desc.text || "";
                } else if (o_dynamic.major?.opus) {
                    if (o_dynamic.major.opus.summary?.text) {
                        o_text = o_dynamic.major.opus.summary.text;
                    } else if (o_dynamic.major.opus.summary?.rich_text_nodes) {
                        o_text = o_dynamic.major.opus.summary.rich_text_nodes.map(n => n.text).join('');
                    } else {
                        o_text = "";
                    }
                    o_title = o_dynamic.major.opus.title || "";
                }
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
                    o_mediaHtml = `
                        <div style="margin-top:10px; border:1px solid #eee; border-radius:8px; overflow:hidden;">
                            <img src="${o_videoCard.cover}" style="width: 100%; aspect-ratio:16/9; object-fit: cover; max-height: 800px;">
                            <div style="padding:10px; background:#f9f9f9;">
                                <div style="font-weight:bold; font-size:14px;">${o_videoCard.title}</div>
                            </div>
                        </div>
                    `;
                }
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
                            ${o_text ? `<div class="orig-text">${o_text}</div>` : ''}
                            ${o_mediaHtml}
                        </div>
                    </div>
                `;
            }

            htmlContent += `
                <div class="content">
                    ${cardUrl && !hasMedia ? `
                        <div class="decorate-bg">
                            <img src="${cardUrl}" />
                            <div class="decorate-overlay"></div>
                        </div>
                    ` : ''}
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
                                    ${serial ? `<span class="serial-badge" style="color: ${fanColor}; background: ${fanColor}4D;">No.${serial}</span>` : ''}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    ${title ? `<div class="title">${title}</div>` : ''}
                    <div class="stats">
                         <span class="stat-item">${ICONS.share} ${this.formatNumber(module_stat.forward?.count)}</span>
                         <span class="stat-item">${ICONS.comment} ${this.formatNumber(module_stat.comment?.count)}</span>
                         <span class="stat-item">${ICONS.like} ${this.formatNumber(module_stat.like?.count)}</span>
                    </div>
                    <div class="text-content">${text}</div>
                    ${origHtml}
                    ${mediaHtml}
                </div>
            `;
        } 
        // ---------------- USER ----------------
        else if (type === 'user') {
            const info = data.data;
            const face = info.face || 'https://i0.hdslb.com/bfs/face/member/noface.jpg';
            const name = info.name || 'Unknown';
            const sign = info.sign || '';
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
                     mediaHtml = `<div style="display: flex; gap: 12px; margin-top: 25px; overflow: hidden; height: 180px;">
                        ${dynImages.slice(0, 3).map(src => `<img src="${src}" style="height: 180px; width: 180px; object-fit: cover; border-radius: 10px;">`).join('')}
                     </div>`;
                } else if (dynVideo) {
                     mediaHtml = `<div style="margin-top: 25px; display: flex; gap: 18px; background: #f7f8f9; border-radius: 12px; padding: 12px;">
                        <img src="${dynVideo.cover}" style="height: 105px; width: 168px; object-fit: cover; border-radius: 10px;">
                        <div style="flex: 1; font-size: 24px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.4;">${dynVideo.title}</div>
                     </div>`;
                }

                dynamicHtml = `
                    <div style="margin-top: 45px; border-top: 1px solid #eee; padding-top: 30px; text-align: left;">
                        <div style="font-size: 24px; color: #999; margin-bottom: 18px; font-weight: bold;">最近动态</div>
                        <div style="font-size: 28px; color: #333; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;">${dynText}</div>
                        ${mediaHtml}
                    </div>
                `;
            }

            htmlContent += `
                <div class="content">
                    <div class="header" style="justify-content: center; flex-direction: column; text-align: center; margin-bottom: 10px;">
                        <div class="avatar-wrapper" style="width: 150px; height: 150px; margin: 0 auto 20px auto;">
                            <img class="avatar no-frame" src="${face}" style="width: 150px; height: 150px; border-width: 5px;">
                        </div>
                        <div class="user-info" style="align-items: center; margin-left: 0;">
                            <div class="user-name" style="font-size: 40px; display: flex; align-items: center; justify-content: center; gap: 10px;">
                                ${name} 
                                <span class="user-level" style="font-size: 20px; background: #FB7299; color: white; padding: 2px 8px; border-radius: 4px;">Lv${level}</span>
                                ${vipLabel ? `<span style="font-size: 20px; background: #FB7299; color: white; padding: 2px 8px; border-radius: 4px;">${vipLabel}</span>` : ''}
                            </div>
                            ${medalName ? `
                            <div style="margin-top: 8px; display: flex; align-items: center; justify-content: center;">
                                <span style="border: 1px solid #666; border-radius: 4px; overflow: hidden; display: flex;">
                                    <span style="background: #666; color: white; padding: 0 4px; font-size: 18px;">${medalName}</span>
                                    <span style="background: white; color: #666; padding: 0 4px; font-size: 18px;">${medalLevel}</span>
                                </span>
                            </div>` : ''}
                            ${sign ? `<div class="text-content" style="text-align: center; margin-top: 15px; color: #666; font-style: italic; font-size: 20px;">"${sign}"</div>` : ''}
                        </div>
                    </div>
                    <div class="stats" style="display: flex; justify-content: center; margin: 25px auto 0 auto; gap: 40px;">
                        <div style="text-align: center;">
                            <div style="font-size: 28px; font-weight: bold; color: #333;">${this.formatNumber(follower)}</div>
                            <div style="font-size: 20px; color: #999;">粉丝</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 28px; font-weight: bold; color: #333;">${this.formatNumber(following)}</div>
                            <div style="font-size: 20px; color: #999;">关注</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 28px; font-weight: bold; color: #333;">${this.formatNumber(info.likes || 0)}</div>
                            <div style="font-size: 20px; color: #999;">获赞</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 28px; font-weight: bold; color: #333;">${this.formatNumber(info.archive_view || 0)}</div>
                            <div style="font-size: 20px; color: #999;">播放</div>
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
            type: 'jpeg',
            quality: 95,  // 提高质量到95以获得更清晰的图片
            omitBackground: false
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

    async generateHelpCard() {
        await this.init();
        const page = await this.browser.newPage();

        // 设置高质量视口
        await page.setViewport({
            width: 1000,
            height: 1500,
            deviceScaleFactor: 1.5  // 提高到2以获得视网膜屏清晰度
        });

        const style = `
            <style>
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
                    background: linear-gradient(135deg, #fef5f6 0%, #e8f5ff 50%, #f0f9ff 100%);
                    box-sizing: border-box;
                    width: 100%;
                    display: inline-block;
                }

                .card {
                    background: #fff;
                    border-radius: 20px;
                    overflow: hidden;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
                    border: 1px solid rgba(255, 255, 255, 0.9);
                    padding: 28px;
                }

                .header {
                    text-align: center;
                    margin-bottom: 28px;
                    border-bottom: 2px solid #f5f5f5;
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
                    color: #999;
                    font-weight: 500;
                }

                .section {
                    margin-bottom: 28px;
                }

                .section-title {
                    font-size: 26px;
                    font-weight: 700;
                    color: #333;
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
                    background: linear-gradient(135deg, #f8f9fa 0%, #f4f6f8 100%);
                    padding: 12px 16px;
                    border-radius: 12px;
                    font-size: 20px;
                    color: #555;
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
                    background: #fff;
                    border: 2px solid #f0f0f0;
                    padding: 14px 18px;
                    border-radius: 12px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
                }

                .cmd-code {
                    font-family: 'Consolas', 'Monaco', monospace;
                    font-weight: bold;
                    color: #FB7299;
                    background: linear-gradient(135deg, #FFF0F6, #FFE8F0);
                    padding: 6px 12px;
                    border-radius: 8px;
                    font-size: 20px;
                }

                .cmd-desc {
                    font-size: 18px;
                    color: #666;
                    font-weight: 500;
                }

                .footer {
                    text-align: center;
                    font-size: 16px;
                    color: #bbb;
                    margin-top: 12px;
                    font-weight: 400;
                }
            </style>
        `;

        const html = `<html><head>${style}</head><body>
            <div class="container">
                <div class="card">
                    <div class="header">
                        <div class="title">Bilibili Assistant</div>
                        <div class="subtitle">全能 B 站链接解析 & 订阅助手</div>
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

                    <div class="section">
                        <div class="section-title">指令列表</div>
                        <div class="cmd-list">
                            <div class="cmd-item">
                                <span class="cmd-code">/订阅 &lt;uid&gt; &lt;动态|直播&gt;</span>
                                <span class="cmd-desc">订阅 UP 主动态或直播</span>
                            </div>
                            <div class="cmd-item">
                                <span class="cmd-code">/取消订阅 &lt;uid&gt; &lt;动态|直播&gt;</span>
                                <span class="cmd-desc">取消订阅</span>
                            </div>
                            <div class="cmd-item">
                                <span class="cmd-code">/订阅列表</span>
                                <span class="cmd-desc">查看本群订阅列表</span>
                            </div>
                            <div class="cmd-item">
                                <span class="cmd-code">/查询订阅 &lt;uid&gt;</span>
                                <span class="cmd-desc">立即检查某用户动态</span>
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
                        <div class="section-title">管理员指令</div>
                        <div class="cmd-list">
                            <div class="cmd-item">
                                <span class="cmd-code">/登录</span>
                                <span class="cmd-desc">获取 B 站登录二维码</span>
                            </div>
                            <div class="cmd-item">
                                <span class="cmd-code">/验证 &lt;key&gt;</span>
                                <span class="cmd-desc">扫码后验证登录状态</span>
                            </div>
                            <div class="cmd-item">
                                <span class="cmd-code">/黑名单 &lt;add|remove&gt; &lt;qq&gt;</span>
                                <span class="cmd-desc">管理黑名单用户</span>
                            </div>
                            <div class="cmd-item">
                                <span class="cmd-code">/设置 &lt;缓存|轮询&gt; &lt;秒数&gt;</span>
                                <span class="cmd-desc">动态调整系统参数</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="footer">由 NapCat & Puppeteer 驱动</div>
                </div>
            </div>
        </body></html>`;

        await page.setContent(html);
        const container = await page.$('.container');
        const buffer = await container.screenshot({
            type: 'jpeg',
            quality: 95,  // 提高质量到95以获得更清晰的图片
            omitBackground: false
        });

        await page.close();

        return buffer.toString('base64');
    }

    formatNumber(num) {
        if (!num) return '0';
        if (num > 10000) {
            return (num / 10000).toFixed(1) + '万';
        }
        return num.toString();
    }
}

module.exports = new ImageGenerator();
