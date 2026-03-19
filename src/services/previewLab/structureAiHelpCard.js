'use strict'

const browserManager = require('../imageGenerator/core/browser')
const { isNightMode } = require('../imageGenerator/core/theme')
const { getCustomFonts } = require('../imageGenerator/core/formatters')
const { buildPreviewFontFamily, generateUnifiedCSS } = require('../../utils/designSystem')

async function generatePreviewLabAIHelpCard(groupId) {
    return browserManager.withRetry(async () => {
        await browserManager.init()
        const page = await browserManager.createPage({
            width: 1000,
            height: 1500,
            deviceScaleFactor: 1.2
        })

        try {
            const isNight = isNightMode(groupId)
            const themeClass = isNight ? 'theme-dark' : 'theme-light'
            const { css: customFontsCss, families: customFontFamilies } = getCustomFonts()

            const colorData = {
                themeClass,
                badgeColor: '#FB7299',
                gradientMix: isNight ? 'linear-gradient(135deg, #1a1a1a 0%, #2c3e50 100%)' : 'linear-gradient(135deg, #fef5f6 0%, #e8f5ff 50%, #f0f9ff 100%)',
                currentType: { label: 'AI 配置', color: '#FB7299', icon: '🤖' }
            }
            const viewport = { width: 1000, minWidth: 400 }
            const baseCss = generateUnifiedCSS(colorData, viewport, { customFontsCss, customFontFamilies })

            const html = `<!DOCTYPE html>
                <html lang="zh-CN">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    ${baseCss}
                    <style>
                        :root {
                            --link-bg: linear-gradient(135deg, #f8f9fa 0%, #f4f6f8 100%);
                            --link-text: #555;
                            --cmd-item-bg: #fff;
                            --cmd-item-border: #f0f0f0;
                            --cmd-code-bg: linear-gradient(135deg, #FFF0F6, #FFE8F0);
                            --cmd-code-color: #FB7299;
                            --cmd-desc: #666;
                            --footer-text: #bbb;
                        }

                        .theme-dark {
                            --link-bg: #12161B;
                            --link-text: #D1D5DB;
                            --cmd-item-bg: #12161B;
                            --cmd-item-border: rgba(255, 255, 255, 0.08);
                            --cmd-code-bg: rgba(251, 114, 153, 0.15);
                            --cmd-code-color: #FF6699;
                            --cmd-desc: #B0B3B8;
                            --footer-text: #8A8F99;
                        }

                        body {
                            width: 1000px;
                            font-family: ${buildPreviewFontFamily(customFontFamilies)};
                        }

                        .container {
                            padding: 24px;
                            box-sizing: border-box;
                            width: 100%;
                            display: inline-block;
                            border-radius: var(--radius-container);
                        }

                        .card {
                            background: var(--color-card-bg);
                            border-radius: var(--radius-container);
                            overflow: hidden;
                            box-shadow: var(--shadow-card);
                            border: 1px solid var(--color-border);
                            padding: 28px;
                            backdrop-filter: blur(24px) saturate(180%);
                            -webkit-backdrop-filter: blur(24px) saturate(180%);
                            position: relative;
                        }

                        .card::before {
                            content: '';
                            position: absolute;
                            inset: 0;
                            border-radius: var(--radius-container);
                            padding: 1px;
                            background: linear-gradient(180deg, rgba(255, 255, 255, 0.3) 0%, rgba(255, 255, 255, 0.1) 50%, rgba(255, 255, 255, 0.05) 100%);
                            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
                            -webkit-mask-composite: xor;
                            mask-composite: exclude;
                            pointer-events: none;
                        }

                        .header {
                            text-align: center;
                            margin-bottom: 28px;
                            border-bottom: 2px solid var(--cmd-item-border);
                            padding-bottom: 20px;
                        }

                        .title {
                            font-size: var(--font-title);
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
                            color: var(--color-subtext);
                            font-weight: 500;
                        }

                        .section {
                            margin-bottom: 28px;
                        }

                        .section-title {
                            font-size: 26px;
                            font-weight: 700;
                            color: var(--color-text);
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
                </head>
                <body class="${themeClass}">
                    <div class="container" style="background: ${colorData.gradientMix}">
                        <div class="card">
                            <div class="header">
                                <h1 class="title">AI 配置面板</h1>
                                <p class="subtitle">管理 AI 对话与记忆功能</p>
                            </div>

                            <div class="section">
                                <div class="section-title">管理员菜单<span class="cmd-tag tag-admin">群管</span></div>
                                <div class="cmd-list">
                                    <div class="cmd-item">
                                        <span class="cmd-code">/AI 上下文 &lt;条数&gt;</span>
                                        <span class="cmd-desc">设置本群AI上下文消息数量 (1-50)，默认10</span>
                                    </div>
                                    <div class="cmd-item">
                                        <span class="cmd-code">/AI 概率 &lt;0-1&gt;</span>
                                        <span class="cmd-desc">设置本群AI随机回复概率 (0.0-1.0)，默认0.1</span>
                                    </div>
                                    <div class="cmd-item">
                                        <span class="cmd-code">/AI 新对话</span>
                                        <span class="cmd-desc">重置本群AI对话记忆，清空上下文</span>
                                    </div>
                                </div>
                            </div>

                            <div class="section">
                                <div class="section-title">系统菜单<span class="cmd-tag tag-root">Root</span></div>
                                <div class="cmd-list">
                                    <div class="cmd-item">
                                        <span class="cmd-code">/AI 向量阈值 &lt;0-1&gt;</span>
                                        <span class="cmd-desc">设置记忆相似度阈值 (0.0-1.0)，默认0.4，越高越严格</span>
                                    </div>
                                    <div class="cmd-item">
                                        <span class="cmd-code">/AI 向量数量 &lt;数量&gt;</span>
                                        <span class="cmd-desc">设置返回的相关记忆数量 (1-10)，默认3</span>
                                    </div>
                                    <div class="cmd-item">
                                        <span class="cmd-code">/AI 短消息过滤 &lt;字符&gt;</span>
                                        <span class="cmd-desc">设置短消息过滤阈值 (1-50)，默认5字符</span>
                                    </div>
                                    <div class="cmd-item">
                                        <span class="cmd-code">/AI 缓存 &lt;开|关&gt;</span>
                                        <span class="cmd-desc">开关向量搜索缓存功能，提升搜索性能</span>
                                    </div>
                                    <div class="cmd-item">
                                        <span class="cmd-code">/AI 智能保留 &lt;开|关&gt;</span>
                                        <span class="cmd-desc">开关智能记忆保留策略，优先保留重要对话</span>
                                    </div>
                                    <div class="cmd-item">
                                        <span class="cmd-code">/AI 新对话 &lt;群号&gt;</span>
                                        <span class="cmd-desc">重置指定群的AI对话记忆</span>
                                    </div>
                                </div>
                            </div>

                            <div class="footer">
                                <div style="font-size: 14px; opacity: 0.8; margin-bottom: 8px;">输入指令（不带参数）即可获取指令帮助</div>
                                <div>由 NapCat & Puppeteer 驱动</div>
                            </div>
                        </div>
                    </div>
                </body>
                </html>`

            await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 })

            const element = await page.$('.container')
            const buffer = await element.screenshot({
                type: 'png',
                omitBackground: true
            })

            return buffer.toString('base64')
        } finally {
            await browserManager.closePage(page)
        }
    })
}

module.exports = {
    generatePreviewLabAIHelpCard
}
