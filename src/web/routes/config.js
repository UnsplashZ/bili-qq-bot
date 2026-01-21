const express = require('express');
const router = express.Router();
const config = require('../../config');
const logger = require('../../utils/logger');

// 获取全局配置
router.get('/', (req, res, next) => {
  try {
    res.json({
      success: true,
      data: {
        blacklistedQQs: config.blacklistedQQs,
        subscriptionCheckInterval: config.subscriptionCheckInterval,
        aiVectorSimilarityThreshold: config.aiVectorSimilarityThreshold,
        aiVectorSearchLimit: config.aiVectorSearchLimit,
        aiShortMessageThreshold: config.aiShortMessageThreshold,
        aiEnableVectorCache: config.aiEnableVectorCache,
        aiEnableSmartTrim: config.aiEnableSmartTrim
      }
    });
  } catch (error) {
    next(error);
  }
});

// 更新全局配置
router.put('/', (req, res, next) => {
  try {
    const updates = req.body;

    // 允许更新的配置项
    const allowedKeys = [
      'subscriptionCheckInterval',
      'aiVectorSimilarityThreshold',
      'aiVectorSearchLimit',
      'aiShortMessageThreshold',
      'aiEnableVectorCache',
      'aiEnableSmartTrim'
    ];

    Object.keys(updates).forEach(key => {
      if (allowedKeys.includes(key)) {
        config[key] = updates[key];
      }
    });

    config.save();

    res.json({
      success: true,
      message: '全局配置已更新'
    });
  } catch (error) {
    next(error);
  }
});

// 添加到全局黑名单
router.post('/blacklist', (req, res, next) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: '缺少 userId 参数'
      });
    }

    if (!config.blacklistedQQs.includes(userId)) {
      config.blacklistedQQs.push(userId);
      config.save();

      res.json({
        success: true,
        message: '已添加到全局黑名单'
      });
    } else {
      res.json({
        success: false,
        message: '该用户已在全局黑名单中'
      });
    }
  } catch (error) {
    next(error);
  }
});

// 从全局黑名单移除
router.delete('/blacklist/:userId', (req, res, next) => {
  try {
    const { userId } = req.params;
    const index = config.blacklistedQQs.indexOf(userId);

    if (index > -1) {
      config.blacklistedQQs.splice(index, 1);
      config.save();

      res.json({
        success: true,
        message: '已从全局黑名单移除'
      });
    } else {
      res.json({
        success: false,
        message: '该用户不在全局黑名单中'
      });
    }
  } catch (error) {
    next(error);
  }
});

// 获取全局默认配置（用于 WebUI）
router.get('/global', (req, res, next) => {
  try {
    const globalConfig = {
      subscriptionCheckInterval: config.subscriptionCheckInterval,
      nightMode: config.nightMode,
      labelConfig: config.labelConfig,
      showId: config.showId,
      linkCacheTimeout: config.linkCacheTimeout,
      aiContextLimit: config.aiContextLimit,
      aiProbability: config.aiProbability
    };

    res.json({
      success: true,
      data: globalConfig
    });
  } catch (error) {
    next(error);
  }
});

// 更新全局默认配置（用于 WebUI）
router.put('/global', (req, res, next) => {
  try {
    const updates = req.body;

    // 允许更新的配置项
    const allowedKeys = [
      'subscriptionCheckInterval',
      'nightMode',
      'labelConfig',
      'showId',
      'linkCacheTimeout',
      'aiContextLimit',
      'aiProbability'
    ];

    Object.keys(updates).forEach(key => {
      if (allowedKeys.includes(key)) {
        config[key] = updates[key];
      }
    });

    // 保存配置到文件
    config.save();

    logger.info('[WebUI] Global config updated:', updates);

    res.json({
      success: true,
      message: '全局配置已更新'
    });
  } catch (error) {
    logger.error('[WebUI] Failed to update global config:', error);
    next(error);
  }
});

module.exports = router;
