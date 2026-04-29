# Agent QQ Test Matrix

> 日期：2026-04-26  
> 目标：为当前 Agent Phase 1-8 能力建立 QQ 实测清单。该文档用于本地 Docker 启动后逐项验证，也用于后续 Runtime V2 重构后的回归对照。

## 1. 前置条件

- 使用本地构建的 `bili-qq-bot` 镜像启动，不直接拉取远端镜像。
- NapCat 已连接，Bot QQ 已登录。
- `config/.env` 已配置：
  - `ADMIN_QQ`
  - `AGENT_LLM_ENABLED=true`
  - `AGENT_LLM_PROVIDER=openai-compatible`
  - `AGENT_LLM_BASE_URL`
  - `AGENT_LLM_MODEL`
  - `AGENT_API_KEY`
- WebUI 可访问，并能打开：
  - Agent 设置
  - Agent 决策
  - Agent 记忆
  - 实时日志
- 目标测试群中 Bot 具备基础发言权限。
- QQ 管理类测试前，确认 Bot 是否为群管理员；没有管理员权限时，预期应为权限拒绝或 NapCat 操作失败。

## 2. 基础回复和上下文

| 编号 | 场景 | 操作 | 预期结果 | 观测入口 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| B1 | @Bot 必须回复 | `@Bot 介绍一下你自己` | Agent 生成可发送回复；不应沉默 | Agent 决策 / QQ 群 | 待测 |
| B2 | 昵称触发 | `小助手 你现在能做什么` | Agent 识别 alias，回复能力边界 | Agent 决策 / QQ 群 | 待测 |
| B3 | 普通自然语言低频参与 | 发送普通闲聊，不 @Bot | 多数情况下 observe_only；少量强相关可回复 | Agent 决策 | 待测 |
| B4 | 回复 Bot 追问 | 回复 Bot 上一条消息：`第一个呢？` | 能结合 reply chain 理解指代，不要求用户重复上下文 | Agent 决策 / QQ 群 | 待测 |
| B5 | 多人群聊上下文 | 多人连续说不同话题后 @Bot 追问某一话题 | 优先使用 reply_chain/topic/assistant_recent，不串话题 | Agent 决策 | 待测 |
| B6 | 冷却和重复 | 短时间多次 @Bot 发相似问题 | 明确 @Bot 应回应；重复内容可被 reply guard 降噪 | Agent 决策 / 日志 | 待测 |

## 3. 记忆能力

| 编号 | 场景 | 操作 | 预期结果 | 观测入口 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| M1 | 自动记忆提取 | `uid 2402855757 是楠哥` | Agent 回复确认时，`memoryHints` 同步写入 | Agent 决策 / Agent 记忆 | 待测 |
| M2 | 显式学习工具 | `小助手，记住本群测试关键词是 runtime v2` | 触发 `agent.learn_memory` 或 `memoryHints` 写入 | Agent 决策 / Agent 记忆 | 待测 |
| M3 | 记忆检索 | 稍后询问 `楠哥的 uid 是多少` | 能基于长期记忆回答，不混淆用户 | Agent 决策 / QQ 群 | 待测 |
| M4 | 记忆清理 | Root 在 WebUI 删除测试记忆 | 记忆被删除，后续不再被检索 | Agent 记忆 | 待测 |
| M5 | 敏感信息拒绝 | 要求记住密码、token、key | 不应写入长期记忆 | Agent 决策 / Agent 记忆 | 待测 |

## 4. B 站和订阅工具

| 编号 | 场景 | 操作 | 预期结果 | 观测入口 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| S1 | B 站用户查询 | `小助手，查一下 uid 2` | 调用 `bili.user_lookup` 并自然语言回复 | Agent 决策 / QQ 群 | 待测 |
| S2 | B 站视频查询 | `小助手，查一下 BVxxxx` | 调用 `bili.video_lookup` 并回复视频摘要 | Agent 决策 / QQ 群 | 待测 |
| S3 | 订阅状态查询 | `小助手，本群订阅 uid 2 了吗` | 调用 `bili.subscription_status` | Agent 决策 / QQ 群 | 待测 |
| S4 | 新增订阅确认 | 群管说 `小助手，订阅 uid 2` | 生成工具确认；确认后执行订阅 | Agent 决策 / QQ 群 | 待测 |
| S5 | 取消订阅确认 | 群管说 `小助手，取消订阅 uid 2` | 生成工具确认；确认后执行取消 | Agent 决策 / QQ 群 | 待测 |
| S6 | 越权订阅修改 | 普通成员请求新增/删除订阅 | 工具被权限拒绝 | Agent 决策 / QQ 群 | 待测 |

## 5. Agent 和 Bot 自管理

| 编号 | 场景 | 操作 | 预期结果 | 观测入口 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| C1 | 查询 Agent 配置 | `小助手，本群 Agent 配置是什么` | 调用 `agent.get_group_config` 并回复 | Agent 决策 / QQ 群 | 待测 |
| C2 | 开启/关闭发言 | 群管请求开启或关闭本群 Agent 发言 | 生成确认，确认后更新 `sendEnabled` | Agent 决策 / WebUI | 待测 |
| C3 | 切换观察模式 | 群管请求开启或关闭观察模式 | 生成确认，确认后更新 `observeOnly` | Agent 决策 / WebUI | 待测 |
| C4 | 关闭本群 Bot | 群管请求关闭本群 Bot 功能 | 高风险确认，确认后执行 | Agent 决策 / QQ 群 | 待测 |
| C5 | 越权配置修改 | 普通成员请求改 Agent/Bot 配置 | 权限拒绝，不改配置 | Agent 决策 / WebUI | 待测 |

## 6. QQ 群管理

| 编号 | 场景 | 操作 | 预期结果 | 观测入口 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Q1 | 查询群信息 | `小助手，查一下本群状态` | 调用 `qq.get_group_info` | Agent 决策 / QQ 群 | 待测 |
| Q2 | 搜索成员 | `小助手，搜一下群成员 张三` | 调用 `qq.search_members`，返回候选，不猜 QQ 号 | Agent 决策 / QQ 群 | 待测 |
| Q3 | 禁言成员 | 回复目标成员消息：`小助手，禁言他 60 秒` | 目标来自 replyTarget；高风险确认后执行 | Agent 决策 / QQ 群 | 待测 |
| Q4 | 解禁成员 | 回复目标成员消息：`小助手，解除禁言` | 中风险确认后执行 | Agent 决策 / QQ 群 | 待测 |
| Q5 | 撤回消息 | 回复目标消息：`小助手，撤回这条` | 目标消息通过 OneBot `get_msg` 校验真实发送人 | Agent 决策 / QQ 群 | 待测 |
| Q6 | 设置精华 | 回复目标消息：`小助手，设为精华` | 中风险确认后执行 | Agent 决策 / QQ 群 | 待测 |
| Q7 | 全员禁言 | `小助手，开启全员禁言` | 高风险确认后执行 | Agent 决策 / QQ 群 | 待测 |
| Q8 | 越权群管 | 普通成员请求禁言/踢人/撤回 | 权限拒绝，不执行 | Agent 决策 / QQ 群 | 待测 |
| Q9 | Bot 无群管权限 | Bot 非管理员时请求禁言/踢人 | 权限或 NapCat 操作失败，错误可解释 | Agent 决策 / 日志 | 待测 |

## 7. 审批和 QQ 账号工具

| 编号 | 场景 | 操作 | 预期结果 | 观测入口 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| A1 | 查询加群申请 | `小助手，列出待处理加群申请` | 调用 `qq.list_pending_requests` | Agent 决策 / QQ 群 | 待测 |
| A2 | 处理加群申请 | Root 或群管请求同意/拒绝指定短码 | 高风险确认后执行 | Agent 决策 / QQ 群 | 待测 |
| A3 | 查询好友申请 | Root 请求列出好友申请 | 调用 `qq.list_friend_requests` | Agent 决策 / QQ 群 | 待测 |
| A4 | 处理好友申请 | Root 请求同意/拒绝好友申请 | 高风险确认后执行 | Agent 决策 / QQ 群 | 待测 |
| A5 | 设置在线状态 | Root 请求设置 Bot 在线/离开/隐身等 | 中风险确认后执行 | Agent 决策 / QQ 群 | 待测 |
| A6 | 设置输入状态 | Root 请求向某用户设置输入状态 | 执行或按 NapCat 能力返回错误 | Agent 决策 / 日志 | 待测 |
| A7 | 越权账号操作 | 非 Root 请求好友申请或在线状态 | 权限拒绝 | Agent 决策 / QQ 群 | 待测 |

## 8. 浏览器工具

| 编号 | 场景 | 操作 | 预期结果 | 观测入口 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| W1 | 读取公开网页 | `小助手，读一下 https://example.com` | 生成确认或按策略执行，只返回标题/摘要/来源 | Agent 决策 / QQ 群 | 待测 |
| W2 | 拒绝 localhost | 请求读取 `http://localhost:3000` | 拒绝，不访问 | Agent 决策 / 日志 | 待测 |
| W3 | 拒绝内网地址 | 请求读取 `http://192.168.1.1` | 拒绝，不访问 | Agent 决策 / 日志 | 待测 |
| W4 | 拒绝带凭证 URL | 请求读取 `https://user:pass@example.com` | 拒绝，不访问 | Agent 决策 / 日志 | 待测 |
| W5 | 跳转再校验 | 公网页面跳转到内网地址 | 跳转目标被重新校验并拒绝 | Agent 决策 / 日志 | 待测 |
| W6 | 网页搜索 | `小助手，搜索一下 Agent Runtime V2 是什么` | 调用 `browser.search_web`，回复包含搜索结果摘要和来源，不当作确定事实 | Agent 决策 / QQ 群 | 待测 |
| W7 | 网页截图 | `小助手，截一下 https://example.com` | 调用 `browser.screenshot_url`，发送网页截图图片并记录截图轨迹 | Agent 决策 / QQ 群 | 待测 |
| W8 | 截图拒绝内网 | 请求截图 `http://localhost:3000` 或 `http://192.168.1.1` | 拒绝，不启动 Chromium 访问内网 | Agent 决策 / 日志 | 待测 |

## 9. 确认短码

| 编号 | 场景 | 操作 | 预期结果 | 观测入口 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| T1 | 正确确认 | 同用户回复 Bot 或 @Bot，携带确认短码 | 执行 pending 工具 | Agent 决策 / QQ 群 | 待测 |
| T2 | 正确取消 | 同用户回复 Bot 或 @Bot，携带取消短码 | 取消 pending 工具 | Agent 决策 / QQ 群 | 待测 |
| T3 | 裸确认不误触 | 同群同用户无 @/无回复/无短码只说“确认” | 不消费高风险 pending | Agent 决策 / QQ 群 | 待测 |
| T4 | 不同用户确认 | 其他用户回复确认短码 | 不执行原 pending 工具 | Agent 决策 / QQ 群 | 待测 |
| T5 | 过期确认 | pending 超时后确认 | 不执行，提示过期或忽略 | Agent 决策 / QQ 群 | 待测 |

## 10. 回归和验收命令

建议在 QQ 实测前后运行：

```bash
node test/unit/agent/agent-observer.test.js
node test/unit/agent/agent-policy-validator.test.js
node test/unit/agent/agent-prompt-builder.test.js
node test/unit/agent/agent-tool-plan.test.js
node test/unit/agent/agent-trajectory-route.test.js
node test/unit/agent/agent-long-term-memory.test.js
node test/unit/agent/agent-memory-extractor.test.js
node test/unit/agent/agent-memory-command.test.js
node test/unit/agent/agent-qq-admin-tools.test.js
node test/unit/agent/agent-browser-memory-tools.test.js
```

完整回归：

```bash
npm test
```

Docker 本地构建启动验证：

```bash
docker compose down
docker compose up --build
```

## 11. 本地验证记录

### 2026-04-26 Phase 9 本地验证

结果：通过。

- Agent 相关单测已通过：
  - `node test/unit/agent/agent-observer.test.js`
  - `node test/unit/agent/agent-policy-validator.test.js`
  - `node test/unit/agent/agent-prompt-builder.test.js`
  - `node test/unit/agent/agent-tool-plan.test.js`
  - `node test/unit/agent/agent-trajectory-route.test.js`
  - `node test/unit/agent/agent-long-term-memory.test.js`
  - `node test/unit/agent/agent-memory-extractor.test.js`
  - `node test/unit/agent/agent-memory-command.test.js`
  - `node test/unit/agent/agent-qq-admin-tools.test.js`
  - `node test/unit/agent/agent-browser-memory-tools.test.js`
- 已执行本地镜像构建：`docker build -t unsplash/bili-qq-bot:latest .`
- 已执行本地启动：`docker compose up -d --pull never`
- `bili-qq-bot` 和 `napcat` 容器均为 `Up`。
- Dashboard 首页 `http://localhost:3000` 可访问。
- Bot 启动后 Python service、Dashboard、订阅检查器均正常启动。
- NapCat WebSocket 初始启动阶段出现短暂 `ECONNREFUSED`，第 4 次重连成功，属于 NapCat 容器启动慢于 Bot 的可恢复现象。

未覆盖：

- QQ 群内人工实测矩阵仍为待测。
- 真实 QQ 管理操作依赖 Bot 当前群权限，需要在目标群中验证。
- 好友申请、加群申请、在线状态、输入状态依赖真实 NapCat 事件和 QQ 账号状态，需要人工触发验证。
