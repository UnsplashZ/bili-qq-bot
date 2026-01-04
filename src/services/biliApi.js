import axios from 'axios';
import config from '../config.js';
import Logger from '../utils/logger.js';

export default class BiliApi {
  constructor() {
    this.logger = new Logger();
    this.axios = axios.create({
      headers: {
        ...config.bilibili.headers,
        'Cookie': config.bilibili.cookie
      },
      timeout: 10000
    });
  }

  // 获取视频信息
  async getVideoInfo(bvid) {
    try {
      const response = await this.axios.get(config.bilibili.api.videoInfo, {
        params: { bvid }
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message);
      }

      const data = response.data.data;
      return {
        type: 'video',
        title: data.title,
        cover: data.pic,
        author: data.owner.name,
        authorFace: data.owner.face,
        uid: data.owner.mid,
        desc: data.desc,
        duration: this.formatDuration(data.duration),
        pubdate: this.formatDate(data.pubdate),
        view: this.formatNumber(data.stat.view),
        like: this.formatNumber(data.stat.like),
        coin: this.formatNumber(data.stat.coin),
        favorite: this.formatNumber(data.stat.favorite),
        share: this.formatNumber(data.stat.share),
        danmaku: this.formatNumber(data.stat.danmaku),
        reply: this.formatNumber(data.stat.reply)
      };
    } catch (error) {
      this.logger.error('获取视频信息失败:', error);
      throw error;
    }
  }

  // 获取动态信息
  async getDynamicInfo(dynamicId) {
    try {
      const response = await this.axios.get(config.bilibili.api.dynamicInfo, {
        params: { id: dynamicId }
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message);
      }

      const item = response.data.data.item;
      const modules = item.modules;

      return {
        type: 'dynamic',
        author: modules.module_author.name,
        authorFace: modules.module_author.face,
        uid: modules.module_author.mid,
        pubTs: this.formatDate(modules.module_author.pub_ts),
        content: modules.module_dynamic?.desc?.text || '',
        images: modules.module_dynamic?.major?.draw?.items?.map(img => img.src) || [],
        forwardCount: this.formatNumber(modules.module_stat?.forward?.count || 0),
        likeCount: this.formatNumber(modules.module_stat?.like?.count || 0),
        replyCount: this.formatNumber(modules.module_stat?.reply?.count || 0)
      };
    } catch (error) {
      this.logger.error('获取动态信息失败:', error);
      throw error;
    }
  }

  // 获取专栏信息
  async getArticleInfo(cvid) {
    try {
      const response = await this.axios.get(config.bilibili.api.articleInfo, {
        params: { id: cvid }
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message);
      }

      const data = response.data.data;
      
      // 获取作者信息
      const userInfo = await this.getUserInfo(data.mid);

      return {
        type: 'article',
        title: data.title,
        author: userInfo.name,
        authorFace: userInfo.face,
        uid: data.mid,
        banner: data.banner_url || data.image_urls[0],
        summary: data.summary,
        pubdate: this.formatDate(data.publish_time),
        view: this.formatNumber(data.stats.view),
        like: this.formatNumber(data.stats.like),
        favorite: this.formatNumber(data.stats.favorite),
        reply: this.formatNumber(data.stats.reply)
      };
    } catch (error) {
      this.logger.error('获取专栏信息失败:', error);
      throw error;
    }
  }

  // 获取番剧信息
  async getBangumiInfo(seasonId) {
    try {
      const apiUrl = 'https://api.bilibili.com/pgc/view/web/season';
      const response = await this.axios.get(apiUrl, {
        params: { season_id: seasonId.replace(/[^0-9]/g, '') }
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message);
      }

      const data = response.data.result;
      return {
        type: 'bangumi',
        title: data.season_title,
        cover: data.cover,
        evaluate: data.evaluate,
        pubdate: data.publish?.pub_time_show || '',
        rating: data.rating?.score || 0,
        view: this.formatNumber(data.stat?.views || 0),
        follow: this.formatNumber(data.stat?.followers || 0),
        danmaku: this.formatNumber(data.stat?.danmakus || 0),
        episodes: data.episodes?.length || 0
      };
    } catch (error) {
      this.logger.error('获取番剧信息失败:', error);
      throw error;
    }
  }

  // 获取用户信息
  async getUserInfo(uid) {
    try {
      const response = await this.axios.get(config.bilibili.api.userInfo, {
        params: { mid: uid }
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message);
      }

      return {
        name: response.data.data.name,
        face: response.data.data.face
      };
    } catch (error) {
      this.logger.error('获取用户信息失败:', error);
      return { name: '未知用户', face: '' };
    }
  }

  // 格式化时长
  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  // 格式化日期
  formatDate(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // 格式化数字
  formatNumber(num) {
    if (num >= 100000000) {
      return (num / 100000000).toFixed(1) + '亿';
    }
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + '万';
    }
    return num.toString();
  }
}