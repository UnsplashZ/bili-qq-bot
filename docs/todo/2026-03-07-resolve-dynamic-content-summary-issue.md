# resolveDynamicContent 错误偏向 summary 问题记录

日期：2026-03-07

状态：待处理

优先级：高

相关文件：

- `src/services/imageGenerator/renderers/components/contentNodes.js`
- `src/services/imageGenerator/renderers/dynamic.js`
- `src/services/imageGenerator/renderers/user.js`

## 问题描述

`resolveDynamicContent()` 当前存在一条“优先使用 `summary`”的分支：

- `desc` 非空
- `summary` 非空
- `summary` 含 rich link nodes
- `desc.rich_text_nodes` 为空，或 `desc` 看起来像“地址标签缺值”

满足这些条件时，函数会直接把最终正文切换到 `summary`。

## 风险

这条判断没有先确认 `desc.text` 与 `summary.text` 是否语义等价，因此会出现以下错误场景：

1. `desc` 是真实正文。
2. `summary` 是另一段摘要或带链接的补充信息。
3. 最终卡片错误展示 `summary`，覆盖真实 `desc`。

影响范围：

- 动态卡片正文
- 用户主页卡片中的“最近动态”正文

## 当前结论

本问题此前只做了记录，没有进入修复。

原因：

- 直接回退现有逻辑，可能重新引入“链接丢失”或“地址标签只有前缀没有值”的旧问题。
- 当前缺少足够的真实样本来精确定义“哪些场景可以安全借用 `summary`”。

## 建议修复方向

后续修复建议按以下原则收敛：

1. 只有在可证明 `desc` 与 `summary` 等价时，才允许借用 `summary`。
2. 优先考虑“借 rich nodes，不替换 plain text”，避免直接覆盖正文文本。
3. 为 `desc != summary` 的冲突样例补专门回归测试。

## 建议验收点

1. `desc` 与 `summary` 不一致时，最终渲染正文仍以 `desc` 为准。
2. 需要恢复链接或 emoji 时，只补结构化节点，不误改真实正文。
3. 动态卡片与用户卡片“最近动态”都覆盖到回归测试。
