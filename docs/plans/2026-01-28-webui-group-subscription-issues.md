# WebUI 群组与订阅相关问题原因梳理（2026-01-28）

## 问题一：群组列表显示为空（“未找到群组”）
- WebUI 的群组列表来源为后端 `/api/groups`，该接口仅从 `global.bot.groupList` 读取当前已加入的群组数据：[api.js](file:///Users/zheng/dev/Github/bili-qq-bot/src/dashboard/routes/api.js#L116-L143)  
- 当 `global.bot.groupList` 未初始化或为空时，接口返回空数组，WebUI 显示“未找到群组”  
- 修复方向：通过 NapCat OneBot11 的 `get_group_list` 主动拉取并周期刷新，将结果写入 `global.bot.groupList`

## 问题二：已禁用群组“开关按钮”无响应
- WebUI 左侧群组列表仅展示了电源图标 `Power`，但没有绑定点击事件；整行点击只会“选中群组”，不会触发切换  
- 切换逻辑存在但未使用：`handleToggleGroup` 定义在页面中 [Groups.jsx](file:///Users/zheng/dev/Github/bili-qq-bot/dashboard/src/pages/Groups.jsx#L161-L174)  
- 修复方向：为电源图标添加按钮并绑定 `handleToggleGroup`，阻止冒泡避免触发行选中

## 问题三：重启后订阅刷新出现 412（风控拦截页）
- 412 是 B 站安全风控导致的“前置条件失败”，并非必然由 Cookie 过期引起  
- Python 侧已尝试规避（统一 UA/Referer/Origin、启用 `bili_ticket`）[bili_server.py](file:///Users/zheng/dev/Github/bili-qq-bot/src/services/bili_server.py#L19-L32)  
- 重启后初次批量并发拉取订阅/动态更易触发风控，登录一次可因凭据/票据更新而短期恢复  
- 建议方向：启动“预热”与退避、降低并发与请求频率、补全浏览器常见头部、增强日志定位凭据文件与接口名

## 问题四：退群后配置不可见但后台仍查询
- `/api/groups` 只返回当前在 `global.bot.groupList` 的群；退群后，该群不在列表，存量配置无法在 WebUI 可见  
- 订阅检查基于 `subscriptionManager` 的 `groupIds` 与配置，未过滤“已退群”的群，因此后台仍会继续查询与推送  
- 修复方向：  
  - 后端列表合并：将 `groupConfigs/enabledGroups` 与 `groupList` 做并集返回，并为不在群的项标记 `isInGroup: false`  
  - 订阅检查过滤：在 `UpdateChecker` 中基于 `global.bot.groupList` 构建 `activeGroupSet`，对目标群做过滤，避免对退群群发送或发起同步请求  
  - 可选：WebUI 对 `isInGroup: false` 显示“已退群”标识

## 相关代码位置参考
- 群组列表接口与开关：[/src/dashboard/routes/api.js](file:///Users/zheng/dev/Github/bili-qq-bot/src/dashboard/routes/api.js#L116-L176)  
- WebUI 群组页：[/dashboard/src/pages/Groups.jsx](file:///Users/zheng/dev/Github/bili-qq-bot/dashboard/src/pages/Groups.jsx)  
- NapCat WS 连接与群列表刷新：[/src/bot.js](file:///Users/zheng/dev/Github/bili-qq-bot/src/bot.js)  
- 订阅刷新与通知：[/src/services/subscription/updateChecker.js](file:///Users/zheng/dev/Github/bili-qq-bot/src/services/subscription/updateChecker.js)  
- B 站接口适配：[/src/services/bili_server.py](file:///Users/zheng/dev/Github/bili-qq-bot/src/services/bili_server.py)
