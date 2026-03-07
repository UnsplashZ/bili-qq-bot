# Image Generator Review Follow-ups Design

日期：2026-03-07

范围：

- 记录本轮 review 中的 `问题 1`，明确风险和暂不修改的边界
- 为 `问题 2`（emoji 索引加载阻塞渲染）设计优化方案
- 为 `问题 3`（专栏 HTML 代码块被 emoji 替换）设计修复方案

非目标：

- 本文不直接修改任何生产代码
- 本文不覆盖 review 中未列出的其他 image generator 问题
- 本文不讨论 git 提交、归档或发布动作

---

## 1. 背景

本轮 review 在图片渲染链路中识别出 3 个主要问题：

1. `resolveDynamicContent()` 在特定条件下会错误偏向 `summary`，可能替换掉真实 `desc` 正文。
2. 预览卡渲染会同步等待 emoji 索引远程加载，冷启动或 TTL 过期时会显著增加首张卡片延迟。
3. 专栏 HTML 的 emoji 文本替换会进入 `<pre>/<code>` 等代码语义区域，破坏正文内容。

用户当前要求：

- `问题 1` 先写文档记录，不立即修改代码。
- `问题 2` 和 `问题 3` 先输出修复设计，重点看怎样优化解决。

---

## 2. 问题 1 记录：`summary` 误覆盖真实 `desc`

### 2.1 现象

`src/services/imageGenerator/renderers/components/contentNodes.js` 中的 `resolveDynamicContent()` 现在存在一条“优先使用 `summary`”的分支：

- `desc` 非空
- `summary` 非空
- `summary` 带 rich link nodes
- `desc.rich_text_nodes` 为空，或 `desc` 看起来像“地址标签缺值”

满足这些条件时，当前实现会直接把最终正文切到 `summary`。

### 2.2 风险

这个判断没有先确认 `desc.text` 与 `summary.text` 是否语义等价，因此会出现：

- `desc` 是真实正文
- `summary` 是另一段摘要或带链接的补充文本
- 最终卡片错误展示 `summary`

影响面：

- 动态卡片正文
- 用户主页卡片中的“最近动态”正文

风险等级：高

### 2.3 当前结论

本问题在本轮只记录，不进入修复。

保留原因：

- 这条逻辑和当前 opus / desc / summary 的真实数据形态强相关
- 如果直接回退，可能重新引入“链接丢失”和“地址标签只有前缀没有值”的旧问题
- 需要额外样本和回归测试来界定“何时可安全借用 summary”

### 2.4 后续修复方向（记录，不执行）

后续如果修复，推荐收敛为“只有在可证明等价时才借用 `summary`”：

1. 保留 `canBorrowSummaryNodes()` 这类等价判断作为前置条件。
2. 将“优先 summary”从直接替换正文，改为“只借 rich nodes，不替换 plain text”。
3. 为 `desc != summary` 的真实冲突样例建立专门回归测试。

---

## 3. 问题 2：emoji 索引加载阻塞渲染

### 3.1 现象

当前预览卡主路径：

1. `generatePreviewCard()` 调用 `createRenderEmojiContext()`
2. `createRenderEmojiContext()` 默认先 `await provider.ensureLoaded()`
3. `EmojiIndexProvider.ensureLoaded()` 冷启动或 TTL 过期时会同步拉取 B 站 emoji panel 数据
4. 拉取包含两个 business（`reply` / `dynamic`），每个请求超时 8 秒

这意味着：

- 第一张卡片可能在真正开始渲染前先卡住
- TTL 到期后的下一张卡片也可能再被卡住
- 远程接口慢或不可用时，emoji 的“兜底增强能力”反而拖慢主渲染路径

### 3.2 目标

修复后应满足：

1. 预览卡渲染主路径不因 emoji 索引远程加载而阻塞。
2. 已在卡片数据中出现的节点型 emoji 仍然正常显示。
3. 纯文本 `[表情名]` 的补图能力保留，但降级时最多只影响“是否补图”，不影响整张卡片及时生成。
4. TTL 刷新不应该把单次用户请求卡死。

### 3.3 方案选项

#### 方案 A：完全同步加载，缩短超时

做法：

- 保留当前 `await ensureLoaded()`
- 仅把接口超时从 8 秒降到更小值，比如 1 到 2 秒

优点：

- 改动最小
- 行为容易理解

缺点：

- 仍然阻塞主渲染路径
- 网络抖动时只是“少卡一点”，不是根治
- 会把“可选增强能力”继续放在同步关键路径上

结论：不推荐。

#### 方案 B：懒加载但不阻塞当前请求

做法：

- `createRenderEmojiContext()` 不再 `await ensureLoaded()`
- 先返回一个可立即使用的 context
- provider 在后台触发加载或在首次查询 miss 时异步刷新
- 当前请求只使用：
  - seedData 中已有的 emoji 节点
  - provider 当前缓存里已经有的内容

优点：

- 主渲染路径立即解耦
- 冷启动也能先出图
- 节点型 emoji 和已缓存纯文本 emoji 不受影响

缺点：

- 冷启动首张卡的纯文本 emoji 可能还是原文，不一定补图
- 需要明确 provider 的并发与刷新语义

结论：推荐作为主方案。

#### 方案 C：进程启动时预热 emoji 索引

做法：

- 在 bot 启动阶段预热 provider
- 预览卡请求只读缓存

优点：

- 首张卡理论上体验最好
- 请求路径最干净

缺点：

- 启动时引入外部依赖，增加冷启动复杂度
- 启动失败与运行态刷新仍要处理
- 不能替代 TTL 刷新后的非阻塞需求

结论：可作为方案 B 的增强项，但不应单独采用。

### 3.4 推荐方案

推荐：**方案 B 为主，方案 C 作为可选增强。**

核心原则：

- emoji panel 索引属于“增强型只读缓存”
- 不应成为图片渲染同步关键路径上的前置条件

### 3.5 推荐实现设计

#### 设计点 1：`createRenderEmojiContext()` 改为即时返回

建议语义：

- 立即构造 `RenderEmojiContext`
- 同步注册 `seedData` 中已知 emoji 节点
- 不等待 provider 完整加载

结果：

- 卡片内已携带节点型 emoji 的场景不受影响
- 当前请求不会因为 provider 远程加载被阻塞

#### 设计点 2：provider 增加“后台刷新”接口

建议给 `EmojiIndexProvider` 区分两类行为：

1. `ensureLoaded()`
   - 明确表示“调用方愿意等待”
2. `refreshInBackground()`
   - 如果缓存未命中或已过期，则启动单飞加载
   - 但不阻塞当前调用方

预览卡路径只调用 `refreshInBackground()`。

#### 设计点 3：查找逻辑允许“缓存命中即用，未命中即降级”

`lookupEmojiByText()` 语义保持简单：

- 先查 `localIndex`
- 再查 provider 当前内存缓存
- 如果没有，就返回 `null`

不要在 `lookup` 内部做同步等待。

#### 设计点 4：TTL 过期策略改为 stale-while-refresh

推荐缓存策略：

- 有旧缓存但 TTL 已过期：当前请求继续使用旧缓存
- 同时后台发起刷新
- 刷新成功后替换缓存
- 刷新失败时保留旧缓存，不影响当前请求

这样可以避免：

- TTL 一到就卡住下一张卡片
- 远程接口短时波动导致体验抖动

### 3.6 错误处理

错误处理原则：

1. emoji 索引加载失败不能让卡片渲染失败。
2. 后台刷新失败只记 debug / warn，不打断主流程。
3. 如果 provider 尚未加载完成，纯文本 `[表情名]` 保持原文即可。

### 3.7 测试建议

建议补 4 类测试：

1. 冷启动下 `createRenderEmojiContext()` 立即返回，不等待远程 loader。
2. provider 已有缓存时，纯文本 emoji 仍可补图。
3. TTL 过期时当前请求继续读旧缓存，同时后台刷新。
4. loader 抛错时，卡片仍能正常渲染，只是不补纯文本 emoji。

---

## 4. 问题 3：专栏 HTML 代码块被 emoji 替换

### 4.1 现象

`replaceEmojiTokensInHtml()` 目前用简单的 HTML 分段替换策略：

- 只排除了 `script/style/textarea`
- 其余标签之间的文本节点都会走 `[表情名] -> <img>` 替换

因此下面这类正文会被误改：

- `<pre>[星星眼]</pre>`
- `<code>[星星眼]</code>`
- `<kbd>[星星眼]</kbd>`（如果存在）

这会把原本应保留的代码或示例文本变成图片标签。

### 4.2 目标

修复后应满足：

1. 正常段落、标题、列表中的 emoji 文本仍可替换。
2. 代码语义区域中的文本必须原样保留。
3. 不影响现有“不要碰标签属性”的安全边界。
4. 修复方式尽量小，不引入新的 HTML 重写风险。

### 4.3 方案选项

#### 方案 A：扩大 blocklist

做法：

- 在现有 `blockedTag` 逻辑里增加：
  - `pre`
  - `code`
  - `kbd`
  - `samp`

优点：

- 改动最小
- 与当前实现风格一致
- 风险面最小，容易补测试

缺点：

- 仍然是字符串级 HTML 处理，不是通用 DOM 解析
- 以后若出现新的语义保护标签，还需要继续补名单

结论：推荐作为当前修复方案。

#### 方案 B：改为 DOM 级解析后只替换可见文本节点

做法：

- 使用 DOM 解析器遍历文本节点
- 按祖先标签决定是否允许替换

优点：

- 语义最准确
- 扩展性最好

缺点：

- 明显增加实现复杂度
- 服务端渲染侧需要额外 HTML parser 依赖或更重逻辑
- 对当前问题来说属于过度设计

结论：当前阶段不推荐。

### 4.4 推荐方案

推荐：**方案 A，扩大 blocklist。**

首批建议加入：

- `pre`
- `code`
- `kbd`
- `samp`

如果后续专栏 HTML 样本中还存在数学公式、编辑器占位等特殊结构，再按实际样本扩展。

### 4.5 推荐实现设计

在 `replaceEmojiTokensInHtml()` 中：

1. 保留当前“按标签段分割”的整体结构。
2. 把 `blockedTag` 规则从
   - `script|style|textarea`
   扩展为
   - `script|style|textarea|pre|code|kbd|samp`
3. 继续保持：
   - 不替换标签属性
   - 不替换 blocked tag 内部文本
   - 只替换普通文本节点

### 4.6 测试建议

建议补 3 类测试：

1. `<p>[星星眼]</p>` 仍然正常替换。
2. `<pre>[星星眼]</pre><code>[星星眼]</code>` 保持原文。
3. `<img src=".../[星星眼].png">` 这类属性仍不替换。

---

## 5. 推荐执行顺序

如果后续进入实现，推荐顺序如下：

1. 先修 `问题 3`
   - 影响面小
   - 行为边界明确
   - 容易快速回归
2. 再修 `问题 2`
   - 涉及 provider 生命周期和缓存语义
   - 需要补并发与 TTL 测试
3. 最后单独处理 `问题 1`
   - 需要真实样本和更谨慎的正文选择策略

---

## 6. 最终建议

本轮建议结论：

1. `问题 1` 只记录，不急于直接回退逻辑。
2. `问题 2` 采用“非阻塞 context + 后台刷新 provider + stale-while-refresh”的方向，核心目标是把 emoji 索引加载从同步渲染路径中移出。
3. `问题 3` 采用“小修复”策略，先把 `<pre>/<code>` 等代码语义标签加入 blocklist，避免误替换。

这样可以先解决两个确定性问题，同时不在 `问题 1` 上做过度冒进的修复。
