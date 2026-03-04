# 2026-03-04 动态富文本与附加卡片完整改造方案（保持现有风格）

**状态**: 待实施  
**适用仓库**: `bili-qq-bot`  
**参考文档**: `docs/plans/dynamic-rich-content-rendering-guide.md`  
**目标模块**: `src/services/imageGenerator`、`src/services/bili_server.py`

## 1. 背景与目标

当前项目已经具备动态卡片的基础渲染能力（正文、投票、转发、图片/视频主卡），但与参考实现相比仍存在空白：

1. `rich_text_nodes` 类型支持不完整（`WEB/LOTTERY/GOODS` 等未完整覆盖）。
2. `module_dynamic.additional` 仅覆盖投票，缺少 `COMMON/RESERVE/UGC/GOODS/UPOWER_LOTTERY` 附加卡渲染。
3. 缺少独立的 `topic` 模块视觉块（目前偏向正文注入）。
4. 行内富文本节点缺少“图标 + 链接色”的统一视觉规则。

本方案目标是在不破坏当前卡片风格的前提下，完整补齐动态富文本与附加卡能力，并保证链接解析与订阅推送走同一渲染结果。

## 2. 设计原则（风格一致约束）

### 2.1 必须遵守

1. 保留现有预览卡片结构：`container -> card -> content`。
2. 继续使用 `theme.js` 的设计变量（`--color-*`、`--radius-*`、`--shadow-*`），不引入新设计体系。
3. 不修改消息发送链路、缓存策略、订阅业务语义。
4. 夜间模式通过现有变量自动适配，不引入额外主题开关。

### 2.2 明确不做

1. 不重做动态卡片整体布局。
2. 不引入新的第三方渲染库。
3. 不改动链接解析规则和订阅触发时机。

## 3. 现状差距分析

| 能力点 | 当前状态 | 差距 | 优先级 |
|---|---|---|---|
| 富文本节点分发 | `TEXT/EMOJI/AT/TOPIC/VOTE/BV(URL)` | 缺 `WEB/LOTTERY/GOODS`，且 `WEB` 与 `URL` 类型兼容不完整 | P0 |
| 话题模块（`module_dynamic.topic`） | 主要通过节点注入兜底 | 缺独立视觉块 | P1 |
| 附加卡片 `additional` | 仅 `vote` | 缺 `COMMON/RESERVE/UGC/GOODS/UPOWER_LOTTERY` | P0 |
| 行内视觉 | 文本高亮为主 | 缺统一的“图标胶囊 + 链接色文案” | P1 |
| 数据标准化 | 已有部分补全（话题、投票） | `additional` 字段兼容与节点类型归一不足 | P0 |

## 4. 总体方案

### 4.1 分层改造

1. **数据标准化层（Python）**  
   在 `bili_server.py` 对动态详情做轻量归一，确保 Node 渲染层拿到稳定结构。
2. **渲染分发层（Node）**  
   在 `dynamic.js` 中新增 `topic/additional` 渲染挂点；在 `richtext.js` 完整覆盖节点类型。
3. **样式层（theme）**  
   在 `theme.js` 新增少量动态专属 class，沿用现有变量体系，保证昼夜一致。

### 4.2 模块渲染顺序（保持当前观感）

动态正文区推荐顺序：

1. `topic` 模块（新增，若存在）
2. `title`
3. `text-content`（rich text）
4. `vote` 卡（已存在）
5. `orig` 卡（已存在）
6. `media`（图片/视频，已存在）
7. `additional` 卡（新增）
8. `action-bar`（已存在）

说明：该顺序在不破坏当前用户认知的前提下，补齐 `topic/additional`，并与现有“正文 -> 扩展信息 -> 统计”结构一致。

## 5. 详细设计

### 5.1 数据标准化设计（`src/services/bili_server.py`）

#### 5.1.1 富文本节点类型兼容归一

目标：兼容 B 站返回中的类型差异，Node 渲染层无需多处分支。

规则：

1. 保留原始 `type`，同时在归一函数中把 `RICH_TEXT_NODE_TYPE_URL` 与 `RICH_TEXT_NODE_TYPE_WEB` 视为等价。
2. `text`、`orig_text` 缺失时补空字符串，避免前端空对象异常。
3. `jump_url` 缺失时保留空字符串，不阻断渲染。

#### 5.1.2 `additional` 结构兼容补齐

对 `module_dynamic.additional` 做“存在即透传 + 关键字段兜底”：

1. `type` 缺失则判定为未知类型，前端跳过。
2. 各子对象非 dict 时降级为空对象。
3. `goods.items` 非数组时降级为空数组。

不做跨接口深度补数，避免增加详情请求链路复杂度。

### 5.2 富文本节点渲染增强（`renderers/components/richtext.js`）

新增节点映射（兼容旧类型）：

| 节点类型 | 新视觉 | 说明 |
|---|---|---|
| `TEXT` | 普通文本 | 保持现状 |
| `EMOJI` | 图片 emoji | 保持现状 |
| `AT` | 高亮文本 | 保持现状 |
| `TOPIC` | 话题高亮文本 | 保持现状 |
| `WEB/URL` | 图标胶囊 + 链接色 | 新增统一图标样式 |
| `BV` | 图标胶囊 + 链接色 | 与 `WEB` 统一 |
| `VOTE` | 图标胶囊 + 链接色 | 与投票卡风格呼应 |
| `LOTTERY` | 图标胶囊 + 链接色 | 新增 |
| `GOODS` | 图标胶囊 + 链接色 | 新增 |

实现方式：

1. 新增 `renderInlineRichNode(node)` 分发函数。
2. 节点图标统一来自 `renderers/icons.js`。
3. 所有节点文本继续 `escapeHtml`，避免 HTML 注入。

### 5.3 话题模块设计（新增组件）

建议新增：`src/services/imageGenerator/renderers/components/dynamicTopic.js`

输入：

1. `module_dynamic.topic`
2. `desc.rich_text_nodes`（仅用于避免重复显示策略）

输出：

1. 统一 `topic-chip` 块：左侧话题图标，右侧 `#话题名#` 链接色文本。
2. 若正文第一个节点已是同名话题，可保留但避免重复“块级 + 行内同位重复”。

视觉规则：

1. 背景使用 `var(--color-soft-bg)`。
2. 边框使用 `var(--color-border)`。
3. 圆角、字号与现有 `vote-card`/`orig-card` 同级别，不新增突兀样式。

### 5.4 附加卡片设计（新增组件）

建议新增：`src/services/imageGenerator/renderers/components/dynamicAdditional.js`

统一入口：

1. `renderAdditionalCard(additional)`
2. `switch(additional.type)` 分发

支持类型与视觉：

1. `ADDITIONAL_TYPE_COMMON`  
   渲染“信息卡”：`head_text + cover + title + desc1 + desc2`。
2. `ADDITIONAL_TYPE_RESERVE`  
   渲染“预约卡”：标题、时间、状态文案（可预约/已预约）。
3. `ADDITIONAL_TYPE_VOTE`  
   继续复用现有 `renderVoteCard`（兼容已实现能力）。
4. `ADDITIONAL_TYPE_UGC`  
   渲染“小型内容卡”：封面 + 标题 + 副标题。
5. `ADDITIONAL_TYPE_GOODS`  
   第一阶段渲染首个商品（标题、价格、封面）；第二阶段可扩展 2-3 商品横向。
6. `ADDITIONAL_TYPE_UPOWER_LOTTERY`  
   渲染“抽奖信息卡”：标题、截止时间、参与提示。

布局约束：

1. 与 `vote-card` 使用同等外边距节奏（`margin-top`）。
2. 卡内字体层级沿用当前正文/副文案比例，不改变整体信息密度。

### 5.5 动态主渲染整合（`renderers/dynamic.js`）

需要新增：

1. `renderTopicBlock(module_dynamic.topic, resolvedText)` 调用点。
2. `renderAdditionalCard(module_dynamic.additional)` 调用点。

保留：

1. 现有 `vote/orig/media/action-bar` 逻辑。
2. 现有 `desc <- opus.summary` 借用逻辑与 topic 注入兜底逻辑。

### 5.6 主题样式扩展（`core/theme.js`）

新增 class（示例）：

1. `.topic-chip`, `.topic-chip-icon`, `.topic-chip-text`
2. `.inline-node`, `.inline-node-icon`, `.inline-node-text`
3. `.additional-card`, `.additional-card-header`, `.additional-card-cover`, `.additional-card-meta`
4. `.additional-goods-price`, `.additional-status-tag`

样式策略：

1. 所有颜色来自 `--color-*` 变量。
2. 夜间模式不写硬编码颜色分支，依赖变量继承。
3. 控制动画为 0 或极弱，保持当前“信息卡片优先可读性”的风格。

## 6. 分阶段实施计划

### 阶段 1：数据与兼容层（P0）

目标：

1. 完成 `rich node type` 兼容归一。
2. 打通 `additional` 透传与防御性降级。

改动文件：

1. `src/services/bili_server.py`
2. `src/services/imageGenerator/renderers/components/richtext.js`（兼容分支先落地）

验收：

1. 未知节点/附加类型不抛异常。
2. `WEB/URL` 两种类型都能稳定显示。

### 阶段 2：渲染组件落地（P0/P1）

目标：

1. 新增 `topic` 块渲染。
2. 新增 `additional` 多类型卡片渲染。
3. 完成 `dynamic.js` 调用链整合。

改动文件：

1. `src/services/imageGenerator/renderers/components/dynamicTopic.js`（新增）
2. `src/services/imageGenerator/renderers/components/dynamicAdditional.js`（新增）
3. `src/services/imageGenerator/renderers/dynamic.js`
4. `src/services/imageGenerator/renderers/icons.js`（补充节点图标）

验收：

1. 6 类 `additional.type` 都能渲染或安全跳过。
2. `topic` 在有数据时稳定展示，不影响原正文布局。

### 阶段 3：样式统一与视觉收敛（P1）

目标：

1. 补齐 `theme.js` 新样式。
2. 确保新内容与现有投票卡/转发卡/正文风格统一。

改动文件：

1. `src/services/imageGenerator/core/theme.js`

验收：

1. 浅色与夜间模式都无突兀硬编码色块。
2. 新增块间距与现有模块节奏一致，不出现拥挤或漂移。

### 阶段 4：测试与回归（P0）

目标：

1. 增加关键单测（节点分发、附加分发、降级策略）。
2. 视觉对比覆盖至少 2 条动态样本（含夜间）。

建议新增测试文件：

1. `test/unit/richtext-dynamic-node-dispatch.test.js`
2. `test/unit/dynamic-additional-renderer.test.js`
3. `test/unit/dynamic-topic-renderer.test.js`

## 7. 视觉效果定义（新增内容）

### 7.1 行内节点视觉

1. 链接类节点（`WEB/BV/VOTE/LOTTERY/GOODS`）统一为“轻量胶囊”：
   - 左图标：16-18px
   - 右文本：链接色
   - 胶囊底色：`var(--color-soft-bg-2)`
2. `AT/TOPIC` 仍以文本高亮为主，保持当前阅读连贯性。

### 7.2 话题模块视觉

1. 位于正文上方的单行信息条。
2. 与 `orig-card` 同级视觉语气：柔和底色 + 细边框 + 圆角。

### 7.3 附加卡片视觉

1. 与现有 `vote-card` 统一卡片骨架（圆角、边框、阴影层级）。
2. 按内容类型只变化“卡片内部结构”，不改变外层风格。

## 8. 容错与降级策略

1. 图标不存在：退化为纯文本节点，不中断。
2. 图片加载失败：保留文案与占位背景。
3. `additional` 字段缺失：跳过该附加卡，保留其余模块。
4. 未知 `rich_text_nodes.type`：按安全文本输出。
5. 未知 `additional.type`：记录 debug 日志并跳过。

## 9. 验收标准

### 9.1 功能验收

1. 动态链接解析与订阅推送都能输出带新增模块的图片。
2. 参考文档列出的节点类型与附加类型均有对应渲染或降级逻辑。
3. 无运行时异常（`TypeError`、空对象访问、HTML 注入风险）。

### 9.2 视觉验收

1. 新增模块与现有卡片风格一致（字体、圆角、边框、色阶一致）。
2. 夜间模式下没有浅色硬编码块。
3. 纵向节奏稳定，无明显布局跳变。

### 9.3 回归验收

1. 既有动态样本（包含投票、转发、图片）效果保持可接受一致。
2. 非动态类型（视频/番剧/直播/用户/专栏）不受影响。

## 10. 风险与回滚

### 10.1 主要风险

1. B 站字段波动导致某些类型数据不完整。
2. 新增样式与旧样式优先级冲突，造成局部错位。
3. 过多视觉元素影响正文可读性。

### 10.2 风险缓解

1. 渲染层全部采用“可选链 + 空值降级”。
2. 新样式 class 前缀化（`topic-`、`additional-`、`inline-node-`）降低冲突。
3. 对复杂类型先上线“简版卡片”再增量增强（如 `GOODS` 首商品优先）。

### 10.3 回滚策略

1. 按阶段提交，支持单阶段回滚。
2. 若新增卡片导致异常，优先回退 `dynamicAdditional` 接入点（保留其他能力）。
3. 若行内图标影响观感，可回退到纯文本高亮，不影响功能完整性。

## 11. 预计改动文件清单

### 11.1 修改文件

1. `src/services/bili_server.py`
2. `src/services/imageGenerator/renderers/components/richtext.js`
3. `src/services/imageGenerator/renderers/dynamic.js`
4. `src/services/imageGenerator/renderers/icons.js`
5. `src/services/imageGenerator/core/theme.js`

### 11.2 新增文件

1. `src/services/imageGenerator/renderers/components/dynamicTopic.js`
2. `src/services/imageGenerator/renderers/components/dynamicAdditional.js`
3. `test/unit/richtext-dynamic-node-dispatch.test.js`
4. `test/unit/dynamic-additional-renderer.test.js`
5. `test/unit/dynamic-topic-renderer.test.js`

## 12. 里程碑与工时预估

1. 阶段 1（数据兼容）：0.5 天
2. 阶段 2（渲染接入）：1.0 天
3. 阶段 3（样式收敛）：0.5 天
4. 阶段 4（测试回归）：0.5 天

总计：约 2.5 天（不含线上灰度观察）

