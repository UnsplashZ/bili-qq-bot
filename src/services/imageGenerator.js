import puppeteer from 'puppeteer';
import config from '../config.js';
import Logger from '../utils/logger.js';
import path from 'path';
import fs from 'fs';

export default class ImageGenerator {
  constructor() {
    this.logger = new Logger();
    this.browser = null;
  }

  async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch(config.image.puppeteer);
    }
    return this.browser;
  }

  async generate(type, data) {
    try {
      const browser = await this.initBrowser();
      const page = await browser.newPage();
      
      // 设置视口大小
      await page.setViewport({ width: 800, height: 1200 });

      // 根据类型生成不同的HTML
      let html;
      switch (type) {
        case 'video':
          html = this.generateVideoHTML(data);
          break;
        case 'dynamic':
          html = this.generateDynamicHTML(data);
          break;
        case 'article':
          html = this.generateArticleHTML(data);
          break;
        case 'bangumi':
          html = this.generateBangumiHTML(data);
          break;
        default:
          throw new Error(`未知类型: ${type}`);
      }

      await page.setContent(html);
      
      // 等待图片加载
      await page.waitForTimeout(1000);

      // 生成截图
      const filename = `bili_${type}_${Date.now()}.png`;
      const filepath = path.join(config.image.output.path, filename);
      
      await page.screenshot({
        path: filepath,
        fullPage: false,
        clip: { x: 0, y: 0, width: 800, height: await this.getContentHeight(page) }
      });

      await page.close();

      this.logger.info(`生成图片成功: ${filename}`);
      return filepath;
    } catch (error) {
      this.logger.error('生成图片失败:', error);
      throw error;
    }
  }

  async getContentHeight(page) {
    return await page.evaluate(() => {
      return document.querySelector('.card').offsetHeight;
    });
  }

  // 生成视频卡片HTML
  generateVideoHTML(data) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
      font-family: "Microsoft YaHei", Arial, sans-serif;
    }
    .card {
      background: white;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      max-width: 760px;
    }
    .cover {
      width: 100%;
      height: 380px;
      object-fit: cover;
      display: block;
    }
    .content {
      padding: 24px;
    }
    .title {
      font-size: 24px;
      font-weight: bold;
      color: #333;
      margin-bottom: 16px;
      line-height: 1.4;
    }
    .author-row {
      display: flex;
      align-items: center;
      margin-bottom: 20px;
    }
    .avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      margin-right: 12px;
    }
    .author-info {
      flex: 1;
    }
    .author-name {
      font-size: 16px;
      font-weight: bold;
      color: #333;
      margin-bottom: 4px;
    }
    .pubdate {
      font-size: 13px;
      color: #999;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      padding: 20px 0;
      border-top: 1px solid #eee;
    }
    .stat-item {
      text-align: center;
    }
    .stat-label {
      font-size: 13px;
      color: #999;
      margin-bottom: 6px;
    }
    .stat-value {
      font-size: 20px;
      font-weight: bold;
      color: #00a1d6;
    }
    .duration {
      position: absolute;
      bottom: 12px;
      right: 12px;
      background: rgba(0,0,0,0.7);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 14px;
    }
    .cover-wrapper {
      position: relative;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="cover-wrapper">
      <img class="cover" src="${data.cover}" />
      <div class="duration">${data.duration}</div>
    </div>
    <div class="content">
      <div class="title">${data.title}</div>
      <div class="author-row">
        <img class="avatar" src="${data.authorFace}" />
        <div class="author-info">
          <div class="author-name">${data.author}</div>
          <div class="pubdate">${data.pubdate}</div>
        </div>
      </div>
      <div class="stats">
        <div class="stat-item">
          <div class="stat-label">播放</div>
          <div class="stat-value">${data.view}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">点赞</div>
          <div class="stat-value">${data.like}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">收藏</div>
          <div class="stat-value">${data.favorite}</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  // 继续查看第2部分获取其他HTML生成方法...
// 生成动态卡片HTML
  generateDynamicHTML(data) {
    const imagesHTML = data.images.slice(0, 3).map(img => 
      `<img class="dynamic-img" src="${img}" />`
    ).join('');

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
      padding: 20px;
      font-family: "Microsoft YaHei", Arial, sans-serif;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      max-width: 760px;
    }
    .author-row {
      display: flex;
      align-items: center;
      margin-bottom: 20px;
    }
    .avatar {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      margin-right: 14px;
    }
    .author-info {
      flex: 1;
    }
    .author-name {
      font-size: 18px;
      font-weight: bold;
      color: #333;
      margin-bottom: 6px;
    }
    .pubdate {
      font-size: 14px;
      color: #999;
    }
    .content {
      font-size: 16px;
      line-height: 1.6;
      color: #333;
      margin-bottom: 16px;
      white-space: pre-wrap;
    }
    .images {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 20px;
    }
    .dynamic-img {
      width: 100%;
      height: 200px;
      object-fit: cover;
      border-radius: 8px;
    }
    .stats {
      display: flex;
      gap: 24px;
      padding-top: 16px;
      border-top: 1px solid #eee;
    }
    .stat-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      color: #666;
    }
    .stat-value {
      font-weight: bold;
      color: #00a1d6;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="author-row">
      <img class="avatar" src="${data.authorFace}" />
      <div class="author-info">
        <div class="author-name">${data.author}</div>
        <div class="pubdate">${data.pubTs}</div>
      </div>
    </div>
    <div class="content">${data.content || '(无文字内容)'}</div>
    ${imagesHTML ? `<div class="images">${imagesHTML}</div>` : ''}
    <div class="stats">
      <div class="stat-item">
        <span>转发</span>
        <span class="stat-value">${data.forwardCount}</span>
      </div>
      <div class="stat-item">
        <span>点赞</span>
        <span class="stat-value">${data.likeCount}</span>
      </div>
      <div class="stat-item">
        <span>评论</span>
        <span class="stat-value">${data.replyCount}</span>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  // 生成专栏卡片HTML
  generateArticleHTML(data) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
      padding: 20px;
      font-family: "Microsoft YaHei", Arial, sans-serif;
    }
    .card {
      background: white;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      max-width: 760px;
    }
    .banner {
      width: 100%;
      height: 320px;
      object-fit: cover;
    }
    .content {
      padding: 24px;
    }
    .title {
      font-size: 26px;
      font-weight: bold;
      color: #333;
      margin-bottom: 12px;
      line-height: 1.4;
    }
    .summary {
      font-size: 15px;
      color: #666;
      line-height: 1.6;
      margin-bottom: 20px;
    }
    .author-row {
      display: flex;
      align-items: center;
      padding: 16px 0;
      border-top: 1px solid #eee;
      border-bottom: 1px solid #eee;
      margin-bottom: 16px;
    }
    .avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      margin-right: 12px;
    }
    .author-info {
      flex: 1;
    }
    .author-name {
      font-size: 16px;
      font-weight: bold;
      color: #333;
    }
    .pubdate {
      font-size: 13px;
      color: #999;
      margin-top: 4px;
    }
    .stats {
      display: flex;
      gap: 32px;
    }
    .stat-item {
      text-align: center;
    }
    .stat-label {
      font-size: 13px;
      color: #999;
      margin-bottom: 6px;
    }
    .stat-value {
      font-size: 18px;
      font-weight: bold;
      color: #00a1d6;
    }
  </style>
</head>
<body>
  <div class="card">
    <img class="banner" src="${data.banner}" />
    <div class="content">
      <div class="title">${data.title}</div>
      <div class="summary">${data.summary}</div>
      <div class="author-row">
        <img class="avatar" src="${data.authorFace}" />
        <div class="author-info">
          <div class="author-name">${data.author}</div>
          <div class="pubdate">${data.pubdate}</div>
        </div>
      </div>
      <div class="stats">
        <div class="stat-item">
          <div class="stat-label">阅读</div>
          <div class="stat-value">${data.view}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">点赞</div>
          <div class="stat-value">${data.like}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">收藏</div>
          <div class="stat-value">${data.favorite}</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  // 生成番剧卡片HTML
  generateBangumiHTML(data) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
      padding: 20px;
      font-family: "Microsoft YaHei", Arial, sans-serif;
    }
    .card {
      background: white;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      max-width: 760px;
    }
    .cover {
      width: 100%;
      height: 400px;
      object-fit: cover;
    }
    .content {
      padding: 24px;
    }
    .title {
      font-size: 24px;
      font-weight: bold;
      color: #333;
      margin-bottom: 16px;
    }
    .rating {
      display: inline-block;
      background: #ff6b6b;
      color: white;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 16px;
    }
    .evaluate {
      font-size: 15px;
      color: #666;
      line-height: 1.6;
      margin-bottom: 16px;
    }
    .info-row {
      font-size: 14px;
      color: #999;
      margin-bottom: 20px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }
    .stat-item {
      text-align: center;
    }
    .stat-label {
      font-size: 13px;
      color: #999;
      margin-bottom: 6px;
    }
    .stat-value {
      font-size: 20px;
      font-weight: bold;
      color: #00a1d6;
    }
  </style>
</head>
<body>
  <div class="card">
    <img class="cover" src="${data.cover}" />
    <div class="content">
      <div class="title">${data.title}</div>
      ${data.rating ? `<div class="rating">⭐ ${data.rating}分</div>` : ''}
      <div class="evaluate">${data.evaluate || '暂无简介'}</div>
      <div class="info-row">
        ${data.pubdate} · 共${data.episodes}集
      </div>
      <div class="stats">
        <div class="stat-item">
          <div class="stat-label">播放</div>
          <div class="stat-value">${data.view}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">追番</div>
          <div class="stat-value">${data.follow}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">弹幕</div>
          <div class="stat-value">${data.danmaku}</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}