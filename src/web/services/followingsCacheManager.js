const fs = require('fs').promises;
const path = require('path');
const biliApi = require('../../services/biliApi');
const logger = require('../../utils/logger');

class FollowingsCacheManager {
  constructor() {
    this.cache = {
      data: [],                  // 关注用户列表
      lastRefresh: null,         // 上次刷新时间戳 (毫秒)
      cooldownMs: 3600000        // 冷却时间 1小时
    };

    this.cacheFile = path.join(process.cwd(), 'data', 'followings-cache.json');
    this.loadCache();
  }

  // 检查是否可以刷新
  canRefresh() {
    if (!this.cache.lastRefresh) return true;
    const elapsed = Date.now() - this.cache.lastRefresh;
    return elapsed >= this.cache.cooldownMs;
  }

  // 获取下次可刷新的剩余毫秒数
  getCooldownRemaining() {
    if (!this.cache.lastRefresh) return 0;
    const elapsed = Date.now() - this.cache.lastRefresh;
    const remaining = this.cache.cooldownMs - elapsed;
    return Math.max(0, remaining);
  }

  // 刷新数据
  async refresh(groupId) {
    if (!this.canRefresh()) {
      const minutes = Math.ceil(this.getCooldownRemaining() / 60000);
      throw new Error(`刷新过于频繁，请 ${minutes} 分钟后再试`);
    }

    const result = await biliApi.getMyFollowings(null, groupId);

    if (result.status === 'success') {
      this.cache.data = result.data || [];
      this.cache.lastRefresh = Date.now();
      await this.saveCache();
    }

    return result;
  }

  // 获取数据（带缓存信息）
  getData() {
    return {
      data: this.cache.data,
      cache: {
        lastUpdate: this.cache.lastRefresh
          ? new Date(this.cache.lastRefresh).toISOString()
          : null,
        canRefresh: this.canRefresh(),
        cooldownRemaining: this.getCooldownRemaining()
      }
    };
  }

  // 持久化缓存
  async saveCache() {
    try {
      await fs.writeFile(this.cacheFile, JSON.stringify(this.cache, null, 2));
      logger.info('[FollowingsCacheManager] Cache saved');
    } catch (e) {
      logger.error('[FollowingsCacheManager] Failed to save cache:', e);
    }
  }

  // 加载缓存
  async loadCache() {
    try {
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      const loaded = JSON.parse(data);

      // 检查缓存是否过期（超过 7 天自动失效）
      if (loaded.lastRefresh && Date.now() - loaded.lastRefresh < 7 * 24 * 60 * 60 * 1000) {
        this.cache = loaded;
        logger.info('[FollowingsCacheManager] Cache loaded');
      }
    } catch (e) {
      // 文件不存在或解析失败，使用默认值
      logger.info('[FollowingsCacheManager] No cache found, starting fresh');
    }
  }
}

module.exports = new FollowingsCacheManager();
