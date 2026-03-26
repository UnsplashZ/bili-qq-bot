# CLAUDE.md 中度重构更新设计

## Context
当前仓库的 `CLAUDE.md` 仍保留大量有效信息，但其对项目现状的描述已经落后于 2026-03 之后的代码演进。主要偏差集中在测试入口、Python 服务主体位置、Dashboard 前后端拆分、AI pipeline、订阅系统重构、日志与预览调试工具等方面。

本次目标不是全面重写文档定位，而是在保留现有文档“架构地图 + 开发手册”价值的前提下，做一次结构化更新，让 `CLAUDE.md` 与当前代码真实状态重新对齐。

## Goals
1. 修正 `CLAUDE.md` 中已过时或容易误导的事实描述。
2. 补充 2026-03 后成为核心开发入口的新模块与新流程。
3. 保留原文档对新会话友好的信息密度，但压缩历史性、模板化、低价值内容。
4. 使文档同时服务于两类场景：快速理解系统架构、快速定位修改入口与验证方式。

## Non-Goals
- 不把 `CLAUDE.md` 改成纯索引文档。
- 不把所有历史设计决策搬入 `CLAUDE.md`。
- 不新增与当前代码无关的规范、流程或抽象要求。
- 不把 `docs/done/` 中的完整历史记录复制进 `CLAUDE.md`。

## Chosen Approach
采用“结构化更新”方案：
- 保留现有大框架（Project Overview / Project Structure / Commands / Architecture / Pitfalls 等）
- 重写已明显过时的章节
- 新增当前代码主干模块说明
- 收缩旧模板式内容与过细历史兼容细节

这样既能延续现有阅读习惯，也能显著提升文档可信度与导航价值。

## Alternatives Considered

### Option A：补丁式更新
仅修正明显错误的段落，例如 `npm test`、Python 服务入口、Dashboard 拆分结构。

**优点：** 改动小，风险低。
**缺点：** 新旧信息仍然混杂，整体阅读体验不会明显改善。

### Option B：结构化更新（选中）
保留文档的整体角色，但重排关键章节，集中更新 2026-03 后的核心变化。

**优点：** 成本可控、收益最高，适合当前仓库状态。
**缺点：** 需要重写多个章节，diff 会比较明显。

### Option C：导航式瘦身
将文档压缩为“只告诉你去哪里看”的入口索引。

**优点：** 简洁。
**缺点：** 对本项目这种多子系统仓库不够用，会降低单文档可用性。

## Planned Document Structure

### 1. Project Overview
更新为“当前真实系统概览”，突出：
- Node.js + Python + Dashboard 三层结构
- NapCat / OneBot 接入
- Bilibili 多资源解析 + Puppeteer 渲染
- AI 聊天、RAG、订阅检查、日志可观测性等现有能力

### 2. Project Structure
保留主目录说明，但补强现在更重要的子结构：
- `src/services/ai/`
- `src/services/subscription/updateChecker/`
- `src/dashboard/routes/api/modules/`
- `dashboard/src/pages/groups/`, `settings/`, `logs/`
- `src/services/bili_server_core/`
- `tools/preview-lab*.js`

### 3. Common Development Commands
校正并补充：
- `npm test` 为当前主测试入口（Mocha）
- Dashboard 构建/开发命令
- Python health check
- preview-lab / preview-lab-web 的本地验证方式
- 保留真正常用的命令，删掉已经不再是主路径的说法

### 4. Architecture Overview
改成当前代码主干的架构地图，重点覆盖：
- `src/bot.js` 启动顺序与生命周期
- `src/handlers/messageHandler.js` 真实消息处理链
- `src/services/ai/` 下的 AI pipeline
- `src/services/subscription/updateChecker/` 的 helpers/modules 分层
- `src/services/imageGenerator/` 的渲染链与 2026-03 富文本/emoji/补充卡片演进
- Dashboard 前后端拆分结构
- `src/services/bili_server_core/` 的主体化

### 5. Configuration System
保留双层配置说明，并确保与当前实现对齐：
- `.env` + `config.json`
- `groupConfigs[groupId]`
- AI / RAG 全局与群级开关
- 仍然强调 `ensureGroupConfig(groupId)` 与字符串 groupId

### 6. Key Code Locations
从“单个函数表”升级为“按主题的关键文件地图”，覆盖：
- bot / handlers
- ai services
- subscription core
- dashboard api
- dashboard frontend
- image generator
- bili_server_core
- tests / preview tools

### 7. Testing & Verification
从“未来建议”改为“当前真实验证路径”：
- `npm test`
- 代表性单测覆盖面
- preview-lab 回归
- dashboard build / logs / API 验证
- Python 服务 health / endpoint 验证

### 8. Common Pitfalls
保留但更新为当前高价值问题：
- `groupId` 必须统一转字符串
- 私聊虚拟 `private_<userId>` 语义
- Python orphan process / 版本不匹配
- 订阅状态字段保留、状态推进、去重逻辑
- Dashboard tab key / 路由模块拆分后的同步约束

### 9. Debugging Tips
收缩旧式“手改源码打日志”建议，改为：
- 先看现有日志系统和 Logs 页面
- 再看 targeted unit tests
- 再跑 preview-lab / Python health check
- 临时 debug 代码作为最后手段

### 10. Useful Patterns
只保留当前仍稳定、不会误导的常用模式示例，例如：
- 读取/写入 group config
- 调用 `notificationService`
- 生成预览图
- 访问 Bili API

## Concrete Content Changes

### A. 明确修正的过时项
1. `npm test` 不再描述为 placeholder。
2. Python 服务主体从 `src/services/bili_server.py` 调整为 `src/services/bili_server_core/`，并说明前者更多是兼容入口。
3. Dashboard 后端重点改为 `src/dashboard/routes/api/index.js + modules/*.js + shared/*.js`。
4. Dashboard 前端重点改为 pages/hooks/components/constants/utils 拆分结构。
5. 更新 message flow、link handling、AI processing 的现实顺序与关键模块。

### B. 明确新增的内容
1. `src/services/ai/` 多阶段 AI pipeline。
2. `src/services/subscription/updateChecker/` 重构后的模块化结构。
3. Logs 页面与日志接口。
4. `tools/preview-lab.js` / `tools/preview-lab-web.js`。
5. `bili_server_core` 的 web / services / auth / download 分层。

### C. 明确收缩的内容
1. “如何新增命令”的模板化说明压缩为入口说明。
2. “如何新增内容类型支持”的老式五步模板改为更贴近真实链路的简述。
3. 过长的 article/opus 历史兼容细节做摘要保留。
4. 大段“未来推荐加什么测试”改成现有测试地图。
5. 旧式“手动加 debug log/临时脚本”建议大幅收缩。

## Expected Outcome
更新后的 `CLAUDE.md` 应该满足以下标准：
- 新会话读完后能快速理解当前项目的真实结构，而不是 2-3 周前的结构
- 看到某个需求时，能更快定位到正确目录与关键文件
- 不再误导使用过时测试方式或旧入口
- 对 AI、订阅、Dashboard、Python 服务、图片渲染这几条主干链路都有可靠概览

## Risks and Mitigations

### 风险 1：文档改动太大，丢失原有可读性
**缓解：** 保留原主章节骨架，不做纯重写式改名。

### 风险 2：补入过多细节，文档再次膨胀
**缓解：** 只写“结构 + 入口 + 约束 + 验证路径”，不写完整历史。

### 风险 3：仍然遗漏 2026-03 后的重要入口
**缓解：** 以已读代码和 `docs/done/2026-03-*` 为依据，优先覆盖 AI、subscription、dashboard、bili_server_core、preview/logging。

## Implementation Plan Preview
实际执行时将按以下顺序改文档：
1. 重新梳理目录与命令章节
2. 重写 Architecture Overview
3. 更新 Key Code Locations
4. 更新 Testing & Verification / Debugging / Pitfalls
5. 最后通读一次，删去重复和过时表述

## Review Checklist
本规格确认后，实施阶段应重点验证：
- 文档中的命令是否与当前仓库脚本一致
- 文档中的文件路径是否真实存在
- 关键模块是否使用当前目录结构命名
- 是否仍残留“placeholder / 旧入口 / 旧架构”类描述

## Note on Commit
根据当前会话约束，本次只写规格文档，不自动创建 git commit。若需要提交规格文档，应在你明确要求后再执行。