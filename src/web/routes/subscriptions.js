const express = require('express');
const router = express.Router();
const subscriptionManager = require('../../services/subscription/subscriptionManager');
const biliApi = require('../../services/biliApi');
const logger = require('../../utils/logger');

// 获取群组订阅列表
router.get('/:groupId', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const groupIdNum = parseInt(groupId);

    await subscriptionManager._ensureSubscriptionsLoaded();

    // 获取 UP 主订阅（不再获取头像，提升性能）
    const userSubs = subscriptionManager.userSubs
      .filter(sub => sub.groupIds.includes(groupIdNum))
      .map(sub => ({
        uid: sub.uid,
        name: sub.name,
        lastDynamicId: sub.lastDynamicId,
        lastLiveStatus: sub.lastLiveStatus,
        lastCheckTime: sub.lastCheckTime
      }));

    // 获取番剧订阅（不再获取封面，提升性能）
    const bangumiSubs = subscriptionManager.bangumiSubs
      .filter(sub => sub.groupIds.includes(groupIdNum))
      .map(sub => ({
        season_id: sub.seasonId,
        title: sub.title,
        lastEpId: sub.lastEpId,
        lastCheckTime: sub.lastCheckTime
      }));

    res.json({
      success: true,
      data: {
        users: userSubs,
        bangumi: bangumiSubs
      }
    });
  } catch (error) {
    next(error);
  }
});

// 添加 UP 主订阅
router.post('/:groupId/user', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: '缺少 uid 参数'
      });
    }

    // 直接调用 subscriptionManager，它会自动获取用户信息
    try {
      await subscriptionManager.subscribeUser(parseInt(groupId), uid);

      // 获取订阅后的用户信息用于返回
      const sub = subscriptionManager.userSubs.find(s => s.uid === uid);

      res.json({
        success: true,
        message: '订阅已添加',
        data: {
          uid,
          name: sub ? sub.name : uid
        }
      });
    } catch (subError) {
      logger.error('[WebUI] Subscribe user error:', subError);
      return res.status(404).json({
        success: false,
        message: 'UP 主不存在或无法获取信息'
      });
    }
  } catch (error) {
    logger.error('[WebUI] Failed to subscribe user:', error);
    next(error);
  }
});

// 删除 UP 主订阅
router.delete('/:groupId/user/:uid', async (req, res, next) => {
  try {
    const { groupId, uid } = req.params;
    await subscriptionManager.unsubscribeUser(parseInt(groupId), uid);

    res.json({
      success: true,
      message: '订阅已删除'
    });
  } catch (error) {
    next(error);
  }
});

// 添加番剧订阅
router.post('/:groupId/bangumi', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    let { seasonId } = req.body;

    if (!seasonId) {
      return res.status(400).json({
        success: false,
        message: '缺少 seasonId 参数'
      });
    }

    // 支持从链接中提取 seasonId
    // 支持格式: ss123456, https://www.bilibili.com/bangumi/play/ss123456
    const seasonIdMatch = seasonId.toString().match(/ss(\d+)|season_id=(\d+)|\/ss(\d+)/);
    if (seasonIdMatch) {
      seasonId = seasonIdMatch[1] || seasonIdMatch[2] || seasonIdMatch[3];
    }

    // 直接调用 subscriptionManager，它会自动获取番剧信息
    try {
      await subscriptionManager.subscribeBangumi(parseInt(groupId), seasonId);

      // 获取订阅后的番剧信息用于返回
      const sub = subscriptionManager.bangumiSubs.find(s => s.seasonId === seasonId);

      res.json({
        success: true,
        message: '订阅已添加',
        data: {
          seasonId,
          title: sub ? sub.title : seasonId
        }
      });
    } catch (subError) {
      logger.error('[WebUI] Subscribe bangumi error:', subError);
      return res.status(404).json({
        success: false,
        message: '番剧不存在或无法获取信息'
      });
    }
  } catch (error) {
    logger.error('[WebUI] Failed to subscribe bangumi:', error);
    next(error);
  }
});

// 删除番剧订阅
router.delete('/:groupId/bangumi/:seasonId', async (req, res, next) => {
  try {
    const { groupId, seasonId } = req.params;
    await subscriptionManager.unsubscribeBangumi(parseInt(groupId), seasonId);

    res.json({
      success: true,
      message: '订阅已删除'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
