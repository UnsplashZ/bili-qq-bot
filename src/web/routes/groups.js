const express = require('express');
const router = express.Router();
const config = require('../../config');
const subscriptionManager = require('../../services/subscription/subscriptionManager');
const logger = require('../../utils/logger');

// 获取所有群组
router.get('/', async (req, res, next) => {
  try {
    await subscriptionManager._ensureSubscriptionsLoaded();

    const groupIds = new Set();

    // 从 enabledGroups 获取
    if (config.enabledGroups && config.enabledGroups.length > 0) {
      config.enabledGroups.forEach(id => groupIds.add(id));
    }

    // 从 groupConfigs 获取
    Object.keys(config.groupConfigs).forEach(id => groupIds.add(id));

    // 从订阅中获取
    subscriptionManager.userSubs.forEach(sub => {
      sub.groupIds.forEach(id => groupIds.add(id.toString()));
    });
    subscriptionManager.bangumiSubs.forEach(sub => {
      sub.groupIds.forEach(id => groupIds.add(id.toString()));
    });

    const groups = Array.from(groupIds).map(groupId => {
      const groupConfig = config.groupConfigs[groupId] || {};

      // 统计订阅数 - 支持数字ID和字符串ID（如 private_xxxxx）
      const userSubs = subscriptionManager.userSubs.filter(sub => {
        return sub.groupIds.some(id => {
          // 如果都能转换为数字，按数字比较
          const idNum = parseInt(id);
          const groupIdNum = parseInt(groupId);
          if (!isNaN(idNum) && !isNaN(groupIdNum)) {
            return idNum === groupIdNum;
          }
          // 否则按字符串比较
          return id.toString() === groupId.toString();
        });
      }).length;

      const bangumiSubs = subscriptionManager.bangumiSubs.filter(sub => {
        return sub.groupIds.some(id => {
          // 如果都能转换为数字，按数字比较
          const idNum = parseInt(id);
          const groupIdNum = parseInt(groupId);
          if (!isNaN(idNum) && !isNaN(groupIdNum)) {
            return idNum === groupIdNum;
          }
          // 否则按字符串比较
          return id.toString() === groupId.toString();
        });
      }).length;

      return {
        groupId,
        enabled: config.isGroupEnabled(groupId),
        admins: groupConfig.admins || [],
        blacklist: groupConfig.blacklistedQQs || [],
        subscriptions: {
          users: userSubs,
          bangumi: bangumiSubs
        },
        config: {
          nightMode: config.getGroupConfig(groupId, 'nightMode'),
          labelConfig: config.getGroupConfig(groupId, 'labelConfig'),
          showId: config.getGroupConfig(groupId, 'showId'),
          linkCacheTimeout: config.getGroupConfig(groupId, 'linkCacheTimeout'),
          aiContextLimit: config.getGroupConfig(groupId, 'aiContextLimit'),
          aiProbability: config.getGroupConfig(groupId, 'aiProbability')
        }
      };
    });

    res.json({
      success: true,
      data: groups
    });
  } catch (error) {
    next(error);
  }
});

// 启用群组
router.post('/:groupId/enable', (req, res, next) => {
  try {
    const { groupId } = req.params;
    config.enableGroup(groupId);

    res.json({
      success: true,
      message: '群组已启用'
    });
  } catch (error) {
    next(error);
  }
});

// 禁用群组
router.post('/:groupId/disable', (req, res, next) => {
  try {
    const { groupId } = req.params;
    config.disableGroup(groupId);

    res.json({
      success: true,
      message: '群组已禁用'
    });
  } catch (error) {
    next(error);
  }
});

// 添加群管理员
router.post('/:groupId/admins', (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: '缺少 userId 参数'
      });
    }

    const success = config.addGroupAdmin(groupId, userId);

    res.json({
      success,
      message: success ? '管理员已添加' : '该用户已是管理员'
    });
  } catch (error) {
    next(error);
  }
});

// 删除群管理员
router.delete('/:groupId/admins/:userId', (req, res, next) => {
  try {
    const { groupId, userId } = req.params;
    const success = config.removeGroupAdmin(groupId, userId);

    res.json({
      success,
      message: success ? '管理员已删除' : '该用户不是管理员'
    });
  } catch (error) {
    next(error);
  }
});

// 更新群组配置
router.put('/:groupId/config', (req, res, next) => {
  try {
    const { groupId } = req.params;
    const updates = req.body;

    // 允许更新的配置项
    const allowedKeys = [
      'nightMode', 'labelConfig', 'showId', 'linkCacheTimeout',
      'aiContextLimit', 'aiProbability', 'blacklistedQQs'
    ];

    Object.keys(updates).forEach(key => {
      if (allowedKeys.includes(key)) {
        config.setGroupConfig(groupId, key, updates[key]);
      }
    });

    res.json({
      success: true,
      message: '配置已更新'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
