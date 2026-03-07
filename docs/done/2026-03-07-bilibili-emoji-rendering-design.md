# Bilibili Emoji Rendering Design

**Date:** 2026-03-07

**Goal:** 让仓库现有全部预览卡片类型在可用数据范围内统一、正确地渲染 Bilibili 官方表情，并在资源缺失时稳定回退为原始文本。

## Scope

纳入统一方案的卡片类型：

- `user`
- `dynamic`
- `opus`
- 转发动态原文
- `article`
- `live`
- `video`
- `bangumi`

不纳入本次范围：

- 纯图片像素中自带的表情
- 用户手打的非官方括号文本
- QQ / NapCat 表情发送能力

## Requirements

必须满足：

1. B 站明确返回 `RICH_TEXT_NODE_TYPE_EMOJI` 时，预览图优先渲染图片表情。
2. 资源可用时尽量显示图片；资源不可用时回退原始文本，如 `[星星眼]`。
3. 所有现有卡片类型进入统一正文渲染链路，避免个别卡片绕过共享逻辑。
4. 表情渲染失败不能影响整张预览图生成。

## Current Problem

当前仓库仅在动态富文本渲染器中处理了 `RICH_TEXT_NODE_TYPE_EMOJI`，但并非所有卡片都复用该路径。

典型问题：

- `user` 卡片最近动态直接输出 `desc.text`，未走共享富文本渲染器，导致 `[星星眼]` 显示为文本。
- 其他卡片类型的正文来源与渲染入口分散，未来容易继续出现“某类卡片漏支持”的问题。
- 缺少统一的表情资源缓存与官方表情索引，遇到资源偶发失效时只能直接退回文本。

## Chosen Approach

采用“统一富文本表情渲染层”方案：

`卡片原始数据 -> 正文提取器 -> 富文本标准化 -> 表情资源解析/缓存命中 -> HTML 渲染`

理由：

- 能一次性覆盖现有全部卡片类型。
- 将“卡片差异”与“表情渲染”解耦，后续维护成本低。
- 兼容已有动态富文本能力，不需要为每种卡片重复写一套表情逻辑。

## Architecture

### 1. 正文提取层

职责：针对不同卡片类型提取最可信的正文与节点数据，但不直接输出 HTML。

策略：

- `dynamic` / `opus` / 转发动态：复用现有 `desc` / `summary` 优先级逻辑，尽量保留 `rich_text_nodes`。
- `user`：最近动态直接复用动态正文提取逻辑，不再只读 `desc.text`。
- `article` / `live` / `video` / `bangumi`：即使当前只有纯文本，也统一转换到共享节点结构，保证接入路径一致。

### 2. 富文本标准化层

职责：把来源各异的原始字段统一转换为共享节点模型。

建议节点类型：

- `TEXT`
- `EMOJI`
- `LINK`
- 其他已有富文本类别的统一包装

`EMOJI` 节点至少保留：

- `rawText`
- `iconUrl`
- `emojiId`
- `packageId`

### 3. 表情资源层

职责：提供表情图片资源解析与本地缓存。

优先级：

1. 节点自带 `emoji.icon_url`
2. 本地官方表情索引缓存命中
3. 回退原始文本

缓存记录建议包含：

- `rawText`
- `emojiId`
- `packageId`
- `iconUrl`
- `updatedAt`

缓存用途：

- 给只剩标准官方表情文本的场景补图
- 给偶发资源失效场景提供最近一次可用资源

### 4. HTML 渲染层

职责：统一把标准化节点渲染成 HTML。

渲染规则：

- 命中可用表情资源：输出 `<img class="emoji">`
- 节点或缓存无资源：输出原始文本 `[表情名]`
- 未知节点类型：沿用安全降级，不中断整张卡片

## Fallback Rules

1. `RICH_TEXT_NODE_TYPE_EMOJI` 且资源可用：渲染图片。
2. `RICH_TEXT_NODE_TYPE_EMOJI` 但资源不可用：回退原始文本。
3. 仅有标准官方 `[表情名]` 文本且缓存命中：补图渲染。
4. 仅有标准官方 `[表情名]` 文本但缓存未命中：保留文本。
5. 纯图片内表情、非官方括号文本：不额外识别。

## Integration Points

需要重点统一的入口：

- `src/services/imageGenerator/renderers/user.js`
- `src/services/imageGenerator/renderers/dynamic.js`
- `src/services/imageGenerator/renderers/components/richtext.js`

可能需要接入统一正文标准化能力的卡片：

- `src/services/imageGenerator/renderers/article.js`
- `src/services/imageGenerator/renderers/live.js`
- `src/services/imageGenerator/renderers/video.js`
- `src/services/imageGenerator/renderers/bangumi.js`

## Testing Strategy

至少覆盖以下验收场景：

1. `user` 卡片最近动态中的 emoji 节点能渲染图片。
2. `dynamic` / `opus` / 转发动态已有 emoji 能继续正确渲染。
3. 标准 `[表情名]` 文本在缓存命中时能补图。
4. 资源失效时稳定回退文本，不出现破图影响布局。
5. `article` / `live` / `video` / `bangumi` 接入统一链路后，纯文本场景无视觉回归。

## Risks

- 不同卡片的正文来源并不一致，抽取层需要避免过度泛化。
- 文本级 `[表情名]` 补图只能做保守匹配，不能误伤普通文本。
- 图片资源加载依赖外链，缓存策略需要足够轻量，不能让渲染链路复杂化。

## Decision Log

- 采用统一方案，不做逐卡片打补丁。
- 采用本地缓存 / 兜底映射方案。
- 资源失效时回退原始文本，而不是隐藏或报错。
- 不处理纯图片内表情，不处理非官方括号文本。
