# Bilibili Emoji Repair Design

**Date:** 2026-03-07

**Goal:** 修复当前 Bilibili 官方表情渲染链路中的冷启动失效、跨请求污染和专栏 HTML 正文遗漏问题，同时保留纯文本 `[表情名]` 的补图能力。

## Background

现有实现已经解决了部分卡片中 `RICH_TEXT_NODE_TYPE_EMOJI` 无法显示的问题，但 review 暴露出 3 个核心缺陷：

1. 纯文本 `[表情名]` 补图依赖进程内预热，冷启动第一张卡片无法补图。
2. 全局 registry 会把一次卡片渲染的副作用泄漏到后续卡片，导致误识别风险。
3. `article.html_content` 仍绕过统一表情处理链路。

## Test Links

以下两个真实链接用于设计和后续验证：

- `https://www.bilibili.com/opus/1175371060337442824`
- `https://www.bilibili.com/opus/723219222355771425?from=search`

它们分别代表两种不同的表情数据形态：

### Case A: 结构化 emoji 节点

`1175371060337442824` 的 `summary.rich_text_nodes` 中存在：

- `RICH_TEXT_NODE_TYPE_TEXT`
- `RICH_TEXT_NODE_TYPE_EMOJI([汤圆])`

这类内容应该直接使用节点自带的 `emoji.icon_url` 渲染，不依赖任何预热。

### Case B: 纯文本表情串

`723219222355771425` 的 `summary.rich_text_nodes` 只有单个 `TEXT` 节点，但正文包含大量标准官方 token，例如：

- `[星星眼]`
- `[汤圆]`
- `[tv_白眼]`
- `[热词系列_好耶]`

这类内容需要依赖官方表情索引做纯文本补图。

## Chosen Approach

采用“请求级上下文 + 官方表情索引提供器”的修复方案。

核心原则：

- 表情索引可以缓存
- 渲染副作用不能跨请求共享

## Architecture

### 1. EmojiIndexProvider

职责：提供稳定的“官方表情名 -> 图片资源”的查询能力。

来源优先级：

1. B 站接口冷加载的官方表情索引
2. 当前请求正文里明确出现的 emoji 节点

缓存策略：

- 允许进程级只读缓存
- 缓存内容仅限官方索引数据，不保存某次渲染的临时副作用
- 可设置 TTL，例如 `30min` 到 `6h`

### 2. RenderEmojiContext

每次生成一张预览图时创建一个独立上下文，仅在当前卡片生命周期内有效。

包含：

- 当前卡片从 `RICH_TEXT_NODE_TYPE_EMOJI` 节点采集到的资源
- 当前卡片可见的官方索引视图

销毁时机：

- 当前卡片渲染结束立即丢弃

效果：

- 冷启动时可直接查询 provider
- 不会把上一张卡片的临时结果污染到下一张卡片

### 3. RichText Renderer

将 `parseRichText()` 改为显式接收上下文：

- `parseRichText(nodes, rawText, emojiContext)`

行为规则：

1. 遇到 `RICH_TEXT_NODE_TYPE_EMOJI`
   - 直接使用节点自带 `icon_url`
   - 同时登记到当前请求级 `emojiContext`
2. 遇到纯文本中的标准 `[表情名]`
   - 仅查询当前 `emojiContext` 可见索引
   - 命中则补图
   - 未命中则保留原文
3. 未知节点类型
   - 沿用原有安全降级

### 4. Card Integration

所有现有卡片类型继续纳入统一方案：

- `user`
- `dynamic`
- `opus`
- 转发动态原文
- `article`
- `live`
- `video`
- `bangumi`

其中：

- 有结构化节点的卡片继续优先走节点渲染
- 只有纯文本的卡片使用请求级上下文做补图

## Article HTML Strategy

`article.html_content` 不能用整段字符串替换，否则可能破坏标签结构。

采用 DOM 文本节点替换策略：

1. 保留原有 HTML 结构
2. 遍历文本节点
3. 仅在文本节点中替换标准官方 `[表情名]`
4. 不修改：
   - HTML 标签
   - 属性值
   - 已存在的 `<img>`
   - 链接地址

## Data Flow

统一流程：

`卡片数据 -> 正文提取 -> emojiContext 初始化 -> 富文本渲染 -> 截图`

对两个测试链接的处理：

- `1175371060337442824`
  - 提取 `summary.rich_text_nodes`
  - 直接渲染 `[汤圆]` emoji 节点
- `723219222355771425`
  - 提取纯文本正文
  - 按 token 扫描 `[表情名]`
  - 通过 provider 索引补图

## Invariants

修复后必须满足：

1. 冷启动第一张只含 `[表情名]` 的卡片也能补图。
2. 上一张卡片渲染结果不会影响下一张卡片。
3. `article.html_content` 进入统一规则，但不破坏原 HTML。
4. 节点型 emoji 和纯文本型 emoji 可以并存。
5. 未命中的 token 必须稳定回退原文。

## Testing Strategy

至少需要以下回归：

1. `1175371060337442824`
   - 验证节点型 emoji 在冷启动时也能直接渲染
2. `723219222355771425`
   - 验证纯文本型 `[表情名]` 在冷启动时也能补图
3. 跨请求隔离
   - 第一张卡片注册 `[星星眼]`
   - 第二张卡片普通文本出现 `[星星眼]`
   - 验证不会因前一张卡片污染而误替换
4. 专栏 HTML 正文
   - 验证只替换文本节点
   - 不破坏标签结构

## Risks

- B 站官方表情索引接口的可用性与登录态可能波动，需要本地缓存和失败回退。
- 纯文本 token 替换必须严格保守，避免误伤普通文本。
- HTML 文本节点替换实现要足够轻量，避免引入新的 HTML 安全问题。

## Decision Log

- 继续保留纯文本 `[表情名]` 补图能力。
- 不再使用全局渲染副作用 registry。
- 允许使用只读官方索引缓存。
- 专栏 HTML 正文采用 DOM 文本节点替换，而不是裸字符串替换。
