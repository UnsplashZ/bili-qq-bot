import BiliApi from '../services/biliApi.js';
import ImageGenerator from '../services/imageGenerator.js';
import Logger from '../utils/logger.js';
import path from 'path';
import config from '../config.js';

export default class BiliHandler {
  constructor() {
    this.biliApi = new BiliApi();
    this.imageGenerator = new ImageGenerator();
    this.logger = new Logger();
  }

  async process(biliData) {
    const { type, id } = biliData;

    try {
      let contentData;
      let url;

      switch (type) {
        case 'video':
          contentData = await this.biliApi.getVideoInfo(id);
          url = `https://www.bilibili.com/video/${id}`;
          break;
        case 'dynamic':
          contentData = await this.biliApi.getDynamicInfo(id);
          url = `https://t.bilibili.com/${id}`;
          break;
        case 'article':
          contentData = await this.biliApi.getArticleInfo(id);
          url = `https://www.bilibili.com/read/cv${id}`;
          break;
        case 'bangumi':
          contentData = await this.biliApi.getBangumiInfo(id);
          url = `https://www.bilibili.com/bangumi/play/${id}`;
          break;
        default:
          throw new Error(`未知的内容类型: ${type}`);
      }

      if (!contentData) {
        throw new Error('获取B站内容失败');
      }

      // 生成图片
      const imagePath = await this.imageGenerator.generate(type, contentData);

      return {
        success: true,
        imagePath,
        url,
        data: contentData
      };
    } catch (error) {
      this.logger.error(`处理B站内容失败 (${type}:${id}):`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}