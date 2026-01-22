# Code Review Findings

**Date:** 2026-01-21
**Reviewer:** Antigravity
**Scope:** Backend Core & API Routes

| File | Level | Description |
| :--- | :--- | :--- |
| `src/services/bili_service.py` | Minor | 存在中英文混杂注释，建议统一为简洁中文。 |
| `src/services/bili_service.py` | Minor | `import os` 出现于文件中间，建议移至顶部遵循 PEP 8。 |
| `src/services/bili_service.py` | Major | `load_credential` 未捕获 `json.JSONDecodeError`，若 cookie 文件内容损坏会导致程序崩溃。 |
| `src/services/bili_service.py` | Major | `save_credential` 使用了裸露的 `except:`，掩盖了潜在的权限错误或其他非 IO 异常。 |
| `src/services/biliApi.js` | Minor | 注释风格不统一（中英文混杂），需规范化。 |
| `src/services/biliApi.js` | Critical | 每次 API 请求均 `spawn` 新 Python 进程，高并发下会导致系统资源耗尽及极高延迟。 |
| `src/services/subscriptionService.js` | Minor | 代码注释不完整且风格不统一。 |
| `src/services/subscriptionService.js` | Critical | 轮询检查逻辑若无并发限制，配合 `biliApi` 的进程创建机制，极易在订阅数增加时导致服务器崩溃。 |
| `src/services/subscriptionService.js` | Major | 错误处理逻辑较为简单，缺乏对连续失败的熔断或重试机制。 |
| `src/web/routes/bilibili.js` | Major | `/followings/subscribe` 接口处理批量订阅时采用串行 `await`，处理大量用户时性能低下且易超时。 |
| `src/web/routes/groups.js` | Minor | `GET /` 接口在统计订阅数时使用了嵌套循环 O(N*M)，在群组和订阅数量较大时可能成为性能瓶颈。 |

**Scope:** Frontend & Backend Services (Added)

| File | Level | Description |
| :--- | :--- | :--- |
| `src/web/public/js/app.js` | Critical | 存在严重 XSS 漏洞。使用 `innerHTML` 渲染用户数据（如 `sub.name`, `user.name`, `group.groupId`），未进行任何转义。恶意用户名可执行脚本。 |
| `src/web/public/js/app.js` | Major | `App` 类为 "God Object" (>1000 行)，耦合了 UI 渲染、状态管理和 API 调用，难以维护。建议拆分为 `GroupManager`, `SubscriptionUI` 等组件。 |
| `src/web/public/js/app.js` | Minor | 模态框确认按钮使用 `element.onclick = ...` 赋值。虽然避免了 `addEventListener` 的累积问题，但属反模式，建议使用事件委托或一次性绑定。 |
| `src/web/public/js/app.js` | Minor | 缺乏 Loading 状态反馈。在 `await` 异步操作期间（如同步关注列表），界面无响应，用户可能重复点击。 |
| `src/web/services/followingsCacheManager.js` | Critical | 并发竞争条件（Race Condition）。`refresh` 方法在异步 API 返回前未更新状态，导致并发请求穿透缓存检查，触发多次 Bilibili API 调用。 |
| `src/web/services/followingsCacheManager.js` | Major | 文件写入不安全。使用 `fs.writeFile` 非原子操作，若在写入时进程崩溃，会导致缓存文件损坏（JSON 截断）。建议使用 `write-file-atomic` 模式。 |
| `src/web/public/js/api.js` | Minor | 错误日志重复。`request` 方法中 `console.error` 打印后又抛出错误，导致调用方捕获时再次处理（通常也会打印），造成控制台噪音。 |
