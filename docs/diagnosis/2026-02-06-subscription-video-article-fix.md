# 订阅系统视频/专栏推送问题诊断报告

**日期**: 2026-02-06
**问题**: 订阅功能对于视频和投稿的检查没有推送卡片

## 问题分析

### 根本原因
Python服务（bili_server.py）是旧版本，缺少`/user_videos`和`/user_articles`路由，导致所有视频和专栏检查请求返回404错误。

### 问题发现过程

1. **日志检查**：发现`[UpdateChecker] Checking user videos...`和`[UpdateChecker] Checking user articles...`日志存在，说明检查功能在运行
2. **缺失日志**：没有"Pushed new video"或"Initialized lastVideoId"之后的推送日志（在2026-02-06 14:12之后）
3. **API测试**：创建测试脚本发现所有API调用返回404错误
4. **端口冲突**：发现10001端口被旧的Python进程占用（PID 96901，启动于2月4日下午4点）
5. **路由验证**：检查代码确认路由已正确注册（bili_server.py第1864-1865行）

### 影响范围
- ✅ **动态推送**：正常工作
- ✅ **直播推送**：正常工作
- ✅ **番剧推送**：正常工作
- ❌ **视频推送**：不工作（API返回404）
- ❌ **专栏推送**：不工作（API返回404）

## 解决方案

### 立即修复
停止旧版Python服务：
```bash
kill 96901
```

### 验证修复
运行测试脚本验证API可用性：
```bash
node test_video_article_api.js
```

**测试结果**（修复后）：
```
✅ 视频API正常工作 - 可以获取视频列表
✅ 专栏API正常工作 - 可以获取专栏列表
```

## 技术细节

### API端点
- `POST /user_videos` - 获取用户视频列表
- `POST /user_articles` - 获取用户专栏列表

### 代码位置
- **路由注册**: `/src/services/bili_server.py` (第1864-1865行)
- **处理函数**: `/src/services/bili_server.py` (第1621-1657行)
- **检查逻辑**: `/src/services/subscription/updateChecker.js` (第905-1089行)

### 检查流程
```
checkAll()
  → checkUserVideo(sub, targetGroups)
      → biliApi.getUserVideos(uid, groupId)
          → serviceManager.sendCommand('user_videos', {uid, group_id})
              → POST http://127.0.0.1:10001/user_videos
```

## 预防措施

### 1. 服务健康检查
添加启动时的API端点验证，确保所有必需的路由都已注册：
```javascript
async function validateApiEndpoints() {
    const requiredEndpoints = [
        'user_videos',
        'user_articles',
        'user_dynamic',
        'user_live'
    ];

    for (const endpoint of requiredEndpoints) {
        // 测试端点是否可用
    }
}
```

### 2. 版本检查
在Python服务启动时输出版本信息，便于调试：
```python
logger.info(f"bili_server.py version: {VERSION}")
logger.info(f"Registered routes: {len(app.router.routes())}")
```

### 3. 部署流程
确保重启Bot服务时Python服务也正确重启：
```bash
# 重启服务
npm run stop
sleep 3
npm start
```

### 4. 监控告警
添加订阅检查失败的监控：
- 连续N次API调用失败 → 告警
- 超过X分钟未成功推送 → 告警

## 经验教训

1. **孤儿进程问题**：Bot主进程退出后，Python服务仍在运行（变成孤儿进程）
2. **缺少版本标识**：无法快速判断运行中的服务是否是最新版本
3. **日志级别过高**：DEBUG级别的日志未输出，导致难以定位问题
4. **缺少端点验证**：启动时未验证必需的API端点是否可用

## 后续改进建议

1. **添加版本信息**：在服务启动和健康检查中输出版本号
2. **改进日志**：将关键的检查结果从DEBUG提升到INFO级别
3. **端点验证**：启动时验证所有必需的API端点
4. **进程管理**：使用PM2或Supervisor管理进程，避免孤儿进程
5. **健康检查增强**：`/health`端点返回版本和可用路由列表
