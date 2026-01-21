const express = require('express');
const router = express.Router();
const biliApi = require('../../services/biliApi');
const subscriptionService = require('../../services/subscriptionService');
const followingsCacheManager = require('../services/followingsCacheManager');
const logger = require('../../utils/logger');

// 获取登录二维码 URL
router.get('/login/qrcode', async (req, res, next) => {
  try {
    const result = await biliApi.getLoginUrl();

    if (result.status === 'success') {
      res.json({
        success: true,
        data: {
          qrcodeUrl: result.data.url,
          qrcodeKey: result.data.qrcode_key
        }
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message || '获取二维码失败'
      });
    }
  } catch (error) {
    logger.error('[WebUI] Failed to get login qrcode:', error);
    next(error);
  }
});

// 检查登录状态
router.post('/login/check', async (req, res, next) => {
  try {
    const { qrcodeKey, groupId } = req.body;

    if (!qrcodeKey) {
      return res.status(400).json({
        success: false,
        message: '缺少 qrcodeKey 参数'
      });
    }

    const result = await biliApi.checkLogin(qrcodeKey, groupId);

    if (result.status === 'success') {
      // 登录成功后，触发关注列表刷新
      if (result.data.logged_in) {
        try {
          await subscriptionService.refreshCookieFollowings();
        } catch (e) {
          logger.warn('[WebUI] Failed to refresh followings after login:', e);
        }
      }

      res.json({
        success: true,
        data: result.data
      });
    } else {
      res.json({
        success: false,
        message: result.message || '检查登录状态失败',
        data: result.data
      });
    }
  } catch (error) {
    logger.error('[WebUI] Failed to check login:', error);
    next(error);
  }
});

// 获取关注分组列表
router.get('/following-groups', async (req, res, next) => {
  try {
    const { groupId } = req.query;

    const result = await biliApi.getFollowingGroups(groupId);

    if (result.status === 'success') {
      res.json({
        success: true,
        data: result.data || []
      });
    } else {
      res.status(500).json({
        success: false,
        message: result.message || '获取关注分组失败'
      });
    }
  } catch (error) {
    logger.error('[WebUI] Failed to get following groups:', error);
    next(error);
  }
});

// 获取账号关注列表
router.get('/followings', async (req, res, next) => {
  try {
    // 使用 followingsCacheManager 获取缓存数据和元信息
    const cachedData = followingsCacheManager.getData();

    res.json({
      success: true,
      data: cachedData.data,
      cache: cachedData.cache
    });
  } catch (error) {
    logger.error('[WebUI] Failed to get followings:', error);
    next(error);
  }
});

// 刷新关注列表
router.post('/followings/refresh', async (req, res, next) => {
  try {
    const { groupId } = req.body;

    try {
      // 使用 followingsCacheManager 刷新
      const result = await followingsCacheManager.refresh(groupId);

      if (result.status === 'success') {
        // 获取更新后的缓存数据
        const cachedData = followingsCacheManager.getData();

        res.json({
          success: true,
          message: '关注列表刷新成功',
          data: cachedData.data,
          cache: cachedData.cache
        });
      } else {
        res.status(500).json({
          success: false,
          message: result.message || '刷新失败'
        });
      }
    } catch (error) {
      // 处理冷却时间错误
      if (error.message && error.message.includes('刷新过于频繁')) {
        return res.status(429).json({
          success: false,
          message: error.message
        });
      }
      throw error;
    }
  } catch (error) {
    logger.error('[WebUI] Failed to refresh followings:', error);
    next(error);
  }
});

// 批量添加关注到订阅
router.post('/followings/subscribe', async (req, res, next) => {
  try {
    const { groupId, uids } = req.body;

    if (!groupId || !uids || !Array.isArray(uids) || uids.length === 0) {
      return res.status(400).json({
        success: false,
        message: '缺少 groupId 或 uids 参数'
      });
    }

    const results = {
      success: [],
      failed: []
    };

    // 逐个添加订阅
    for (const uid of uids) {
      try {
        await subscriptionService.addUserSubscription(uid, groupId);
        results.success.push(uid);
      } catch (e) {
        logger.error(`[WebUI] Failed to subscribe user ${uid}:`, e);
        results.failed.push({ uid, error: e.message });
      }
    }

    res.json({
      success: true,
      message: `成功添加 ${results.success.length} 个订阅${results.failed.length > 0 ? `，失败 ${results.failed.length} 个` : ''}`,
      data: results
    });
  } catch (error) {
    logger.error('[WebUI] Failed to batch subscribe:', error);
    next(error);
  }
});

module.exports = router;
