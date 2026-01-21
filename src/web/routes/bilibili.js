const express = require('express');
const router = express.Router();
const biliApi = require('../../services/biliApi');
const subscriptionService = require('../../services/subscriptionService');
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

// 获取账号关注列表
router.get('/followings', async (req, res, next) => {
  try {
    const { groupName, groupId } = req.query;

    // 先尝试从缓存获取
    let followings = subscriptionService.cookieFollowings || [];

    // 如果缓存为空或者指定了 groupName，则重新获取
    if (followings.length === 0 || groupName) {
      try {
        const result = await biliApi.getMyFollowings(groupName, groupId);

        if (result.status === 'success' && result.data) {
          followings = result.data;
          // 更新缓存
          if (!groupName) {
            subscriptionService.cookieFollowings = followings;
          }
        } else {
          logger.warn('[WebUI] Failed to get followings:', result.message);
        }
      } catch (e) {
        logger.error('[WebUI] Error getting followings:', e);
      }
    }

    res.json({
      success: true,
      data: followings
    });
  } catch (error) {
    logger.error('[WebUI] Failed to get followings:', error);
    next(error);
  }
});

// 刷新关注列表
router.post('/followings/refresh', async (req, res, next) => {
  try {
    await subscriptionService.refreshCookieFollowings();

    res.json({
      success: true,
      message: '关注列表刷新成功',
      data: subscriptionService.cookieFollowings || []
    });
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
