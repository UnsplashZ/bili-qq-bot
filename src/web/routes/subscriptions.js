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

    // 获取 UP 主订阅，并补充头像信息
    const userSubsPromises = subscriptionManager.userSubs
      .filter(sub => sub.groupIds.includes(groupIdNum))
      .map(async (sub) => {
        try {
          const userInfo = await biliApi.getUserInfo(sub.uid, groupIdNum);
          return {
            uid: sub.uid,
            name: sub.name,
            face: userInfo?.face || `https://i0.hdslb.com/bfs/face/member/noface.jpg`,
            lastDynamicId: sub.lastDynamicId,
            lastLiveStatus: sub.lastLiveStatus,
            lastCheckTime: sub.lastCheckTime
          };
        } catch (error) {
          logger.warn(`[WebUI] Failed to get user info for ${sub.uid}:`, error.message);
          return {
            uid: sub.uid,
            name: sub.name,
            face: `https://i0.hdslb.com/bfs/face/member/noface.jpg`,
            lastDynamicId: sub.lastDynamicId,
            lastLiveStatus: sub.lastLiveStatus,
            lastCheckTime: sub.lastCheckTime
          };
        }
      });

    // 获取番剧订阅，并补充封面信息
    const bangumiSubsPromises = subscriptionManager.bangumiSubs
      .filter(sub => sub.groupIds.includes(groupIdNum))
      .map(async (sub) => {
        try {
          const bangumiInfo = await biliApi.getBangumiInfo(sub.seasonId, groupIdNum);
          return {
            season_id: sub.seasonId,
            title: sub.title,
            cover: bangumiInfo?.cover || `https://i0.hdslb.com/bfs/bangumi/image/placeholder.jpg`,
            lastEpId: sub.lastEpId,
            lastCheckTime: sub.lastCheckTime
          };
        } catch (error) {
          logger.warn(`[WebUI] Failed to get bangumi info for ${sub.seasonId}:`, error.message);
          return {
            season_id: sub.seasonId,
            title: sub.title,
            cover: `https://i0.hdslb.com/bfs/bangumi/image/placeholder.jpg`,
            lastEpId: sub.lastEpId,
            lastCheckTime: sub.lastCheckTime
          };
        }
      });

    const userSubs = await Promise.all(userSubsPromises);
    const bangumiSubs = await Promise.all(bangumiSubsPromises);

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

    // 获取 UP 主信息
    const userInfo = await biliApi.getUserInfo(uid, groupId);

    if (!userInfo || !userInfo.name) {
      return res.status(404).json({
        success: false,
        message: 'UP 主不存在或无法获取信息'
      });
    }

    // 添加订阅
    await subscriptionManager.subscribeUser(parseInt(groupId), uid, userInfo.name);

    res.json({
      success: true,
      message: '订阅已添加',
      data: {
        uid,
        name: userInfo.name
      }
    });
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
    const { seasonId } = req.body;

    if (!seasonId) {
      return res.status(400).json({
        success: false,
        message: '缺少 seasonId 参数'
      });
    }

    // 获取番剧信息
    const bangumiInfo = await biliApi.getBangumiInfo(seasonId, groupId);

    if (!bangumiInfo || !bangumiInfo.title) {
      return res.status(404).json({
        success: false,
        message: '番剧不存在或无法获取信息'
      });
    }

    // 添加订阅
    await subscriptionManager.subscribeBangumi(
      parseInt(groupId),
      seasonId,
      bangumiInfo.title
    );

    res.json({
      success: true,
      message: '订阅已添加',
      data: {
        seasonId,
        title: bangumiInfo.title
      }
    });
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
