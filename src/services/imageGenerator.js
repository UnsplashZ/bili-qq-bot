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
    share: '<svg viewBox="0 0 24 24" width="16" height="16" fill="#999"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c0 .24-.04.47-.09.7l7.05 4.11c.54-.5 1.25-.81 2.04-.81 1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3z"/></svg>'
};

class ImageGenerator {
    constructor() {
        this.browser = null;
    }

    async init() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                headless: "new"
            });
        }
    }

    async generatePreviewCard(data, type) {
        await this.init();
        const page = await this.browser.newPage();
        
        // Type Config (Label & Color)
        const TYPE_CONFIG = {
            video: { label: '视频', color: '#FB7299', icon: '📺' },
            bangumi: { label: '番剧', color: '#00A1D6', icon: '🎬' },
            article: { label: '专栏', color: '#FAA023', icon: '📰' },
            live: { label: '直播', color: '#FF6699', icon: '📡' },
            dynamic: { label: '动态', color: '#00B5E5', icon: '📱' }
        };
        const currentType = TYPE_CONFIG[type] || { label: 'Bilibili', color: '#FB7299', icon: '' };

        // Polished CSS with Background & Badge
        const style = `
            <style>
                body { margin: 0; padding: 0; background: transparent; width: 520px; font-family: "PingFang SC", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif; }
                
                .container {
                    padding: 20px;
                    background: linear-gradient(135deg, #fcefee 0%, #e6f7ff 100%);
                    box-sizing: border-box;
                    width: 100%;
                    min-height: 200px;
                    display: inline-block;
                }

                .card { 
                    position: relative;
                    background: #fff; 
                    border-radius: 16px; 
                    overflow: hidden; 
                    box-shadow: 0 12px 40px rgba(0,0,0,0.1); 
                    border: 1px solid rgba(255,255,255,0.8);
                }

                /* Type Badge (Moved Outside) */
                .type-badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    margin-bottom: 12px;
                    margin-left: 2px;
                    
                    background: ${currentType.color};
                    color: white;
                    padding: 6px 12px;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: bold;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    text-shadow: 0 1px 2px rgba(0,0,0,0.1);
                }

                .cover-container { position: relative; width: 100%; }
                .cover { width: 100%; display: block; object-fit: cover; }
                .cover.video { aspect-ratio: 16/9; }
                .cover.bangumi { aspect-ratio: 16/9; }
                .cover.live { aspect-ratio: 16/9; }
                .cover.article { aspect-ratio: 21/9; }
                
                .content { padding: 20px; position: relative; }
                
                .header { display: flex; align-items: center; margin-bottom: 12px; }
                .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 12px; border: 2px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
                .user-info { display: flex; flex-direction: column; }
                .user-name { font-size: 15px; font-weight: 700; color: #333; }
                .pub-time { font-size: 12px; color: #999; margin-top: 2px; }
                
                .title { font-size: 18px; font-weight: bold; margin-bottom: 10px; color: #18191C; line-height: 1.4; letter-spacing: 0.5px; }
                
                .text-content { font-size: 15px; color: #444; line-height: 1.7; margin-top: 16px; margin-bottom: 12px; white-space: pre-wrap; word-wrap: break-word; text-align: justify; }
                
                .stats { display: flex; gap: 20px; font-size: 13px; color: #9499A0; align-items: center; margin-bottom: 4px; background: #F6F7F8; padding: 8px 12px; border-radius: 8px; width: fit-content; }
                .stat-item { display: flex; align-items: center; gap: 5px; font-weight: 500; }
                .stat-item svg { fill: #9499A0; }
                
                .images-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 12px; }
                .images-grid img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; cursor: pointer; transition: transform 0.2s; }
                
                .single-image { margin-top: 12px; width: 100%; border-radius: 12px; display: block; height: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
                
                .live-badge-status { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-left: 8px; vertical-align: middle; transform: translateY(-1px); }
                .live-on { background: #FF6699; color: white; }
                .live-off { background: #E7E7E7; color: #999; }

                .video-tag { background: #F6F7F8; color: #666; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin-right: 6px; vertical-align: middle; }
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
            htmlContent += `
                <div class="cover-container">
                    <img class="cover video" src="${info.pic}" />
                </div>
                <div class="content">
                    <div class="header">
                        <img class="avatar" src="${info.owner.face}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                        <div class="user-info">
                            <span class="user-name">${info.owner.name}</span>
                            <span class="pub-time">${new Date(info.pubdate * 1000).toLocaleString()}</span>
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
            htmlContent += `
                <div class="cover-container">
                    <img class="cover bangumi" src="${info.cover}" />
                </div>
                <div class="content">
                    <div class="title">${info.title}</div>
                    <div class="stats">
                        <span class="stat-item">${ICONS.view} ${this.formatNumber(info.stat?.views)}</span>
                        <span class="stat-item">${ICONS.heart} ${this.formatNumber(info.stat?.follow)} 追番</span>
                        <span class="stat-item">${ICONS.star} ${info.rating?.score || 'N/A'}分</span>
                        <span class="stat-item">${info.new_ep?.index_show || ''}</span>
                    </div>
                    <div class="text-content">${info.desc || ''}</div>
                </div>
            `;
        } 
        // ---------------- ARTICLE ----------------
        else if (type === 'article') {
            const info = data.data;
            const cover = info.banner_url || (info.image_urls && info.image_urls.length > 0 ? info.image_urls[0] : '');
            const pubDate = info.publish_time ? new Date(info.publish_time * 1000).toLocaleString() : '';
            
            htmlContent += `
                ${cover ? `<div class="cover-container"><img class="cover article" src="${cover}" /></div>` : ''}
                <div class="content">
                    <div class="header">
                        <div class="user-info">
                            <span class="user-name">${info.author_name || 'Unknown'}</span>
                            <span class="pub-time">${pubDate}</span>
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
                ? `<span class="live-badge-status live-on">LIVE</span>` 
                : `<span class="live-badge-status live-off">OFFLINE</span>`;

            htmlContent += `
                <div class="cover-container">
                    <img class="cover live" src="${roomInfo.cover}" />
                </div>
                <div class="content">
                    <div class="header">
                        <img class="avatar" src="${anchorInfo.base_info?.face}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                        <div class="user-info">
                            <span class="user-name">${anchorInfo.base_info?.uname || 'Unknown'}</span>
                            <span class="pub-time">直播间: ${roomInfo.room_id}</span>
                        </div>
                    </div>
                    <div class="title">${roomInfo.title} ${liveBadge}</div>
                    <div class="stats">
                        <span class="stat-item">${ICONS.fire} ${watched.text_large || watched.num || 0}</span>
                        <span class="stat-item">${ICONS.star} ${info.area_name || ''}</span>
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
                mediaHtml = `<img class="single-image" src="${images[0]}">`;
            } else if (images.length > 1) {
                mediaHtml = `
                    <div class="images-grid">
                        ${images.map(src => `<img src="${src}">`).join('')}
                    </div>`;
            } else if (videoCard) {
                mediaHtml = `
                    <div style="margin-top:12px; border:1px solid #eee; border-radius:8px; overflow:hidden;">
                        <img src="${videoCard.cover}" style="width:100%; aspect-ratio:16/9; object-fit:cover;">
                        <div style="padding:10px; background:#f9f9f9;">
                            <div style="font-weight:bold; font-size:14px;">${videoCard.title}</div>
                        </div>
                    </div>
                `;
            }

            htmlContent += `
                <div class="content">
                    <div class="header">
                        <img class="avatar" src="${authorFace}" onerror="this.src='https://i0.hdslb.com/bfs/face/member/noface.jpg'">
                        <div class="user-info">
                            <span class="user-name">${authorName}</span>
                            <span class="pub-time">${pubTime}</span>
                        </div>
                    </div>
                    ${title ? `<div class="title">${title}</div>` : ''}
                    <div class="stats">
                         <span class="stat-item">${ICONS.share} ${this.formatNumber(module_stat.forward?.count)}</span>
                         <span class="stat-item">${ICONS.comment} ${this.formatNumber(module_stat.comment?.count)}</span>
                         <span class="stat-item">${ICONS.like} ${this.formatNumber(module_stat.like?.count)}</span>
                    </div>
                    <div class="text-content">${text}</div>
                    ${mediaHtml}
                </div>
            `;
        }

        htmlContent += `</div></div></body></html>`;

        await page.setContent(htmlContent);
        // Screenshot the CONTAINER to capture background
        const container = await page.$('.container');
        const buffer = await container.screenshot({ type: 'png' }); 
        
        await page.close();
        
        return buffer.toString('base64');
    }

    async generateHelpCard() {
        await this.init();
        const page = await this.browser.newPage();
        
        const style = `
            <style>
                body { margin: 0; padding: 0; background: transparent; width: 500px; font-family: "PingFang SC", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif; }
                .container {
                    padding: 20px;
                    background: linear-gradient(135deg, #fcefee 0%, #e6f7ff 100%);
                    box-sizing: border-box;
                    width: 100%;
                    display: inline-block;
                }
                .card { 
                    background: #fff; 
                    border-radius: 16px; 
                    overflow: hidden; 
                    box-shadow: 0 12px 40px rgba(0,0,0,0.1); 
                    border: 1px solid rgba(255,255,255,0.8);
                    padding: 24px;
                }
                .header {
                    text-align: center;
                    margin-bottom: 24px;
                    border-bottom: 2px solid #f0f0f0;
                    padding-bottom: 16px;
                }
                .title { font-size: 22px; font-weight: 800; color: #FB7299; margin-bottom: 6px; letter-spacing: 1px; }
                .subtitle { font-size: 14px; color: #999; }
                
                .section { margin-bottom: 24px; }
                .section-title { 
                    font-size: 16px; font-weight: 700; color: #333; margin-bottom: 12px; 
                    display: flex; align-items: center; gap: 8px;
                }
                .section-title::before {
                    content: ''; display: block; width: 4px; height: 16px; background: #00A1D6; border-radius: 2px;
                }
                
                .link-list { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
                .link-item { 
                    background: #F6F7F8; padding: 10px 12px; border-radius: 8px; 
                    font-size: 13px; color: #555; display: flex; align-items: center; gap: 8px;
                    transition: all 0.2s;
                }
                .icon { font-size: 16px; }

                .cmd-list { display: flex; flex-direction: column; gap: 10px; }
                .cmd-item {
                    display: flex; justify-content: space-between; align-items: center;
                    background: #fff; border: 1px solid #eee; padding: 12px 16px; border-radius: 10px;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.02);
                }
                .cmd-code { 
                    font-family: 'Consolas', 'Monaco', monospace; font-weight: bold; color: #FB7299; background: #FFF0F6; 
                    padding: 4px 10px; border-radius: 6px; font-size: 13px;
                }
                .cmd-desc { font-size: 13px; color: #666; }
                
                .footer { text-align: center; font-size: 12px; color: #bbb; margin-top: 10px; }
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
                                <span class="cmd-code">/login</span>
                                <span class="cmd-desc">获取登录二维码</span>
                            </div>
                            <div class="cmd-item">
                                <span class="cmd-code">/check &lt;key&gt;</span>
                                <span class="cmd-desc">验证登录状态</span>
                            </div>
                            <div class="cmd-item">
                                <span class="cmd-code">/sub &lt;uid&gt; dynamic</span>
                                <span class="cmd-desc">订阅UP主动态</span>
                            </div>
                            <div class="cmd-item">
                                <span class="cmd-code">/sub &lt;uid&gt; live</span>
                                <span class="cmd-desc">订阅UP主直播</span>
                            </div>
                            <div class="cmd-item">
                                <span class="cmd-code">/help</span>
                                <span class="cmd-desc">显示此菜单</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="footer">Powered by NapCat & Puppeteer</div>
                </div>
            </div>
        </body></html>`;

        await page.setContent(html);
        const container = await page.$('.container');
        const buffer = await container.screenshot({ type: 'png' });
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