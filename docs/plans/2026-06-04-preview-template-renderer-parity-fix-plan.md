# 2026-06-04 Preview Template Renderer Parity Fix Plan

## 背景

当前 `previewLayoutConfig version: 2` 可视化模板编辑器已经接入后端模板 renderer 和 Puppeteer 截图链路，但默认模板并没有严格复用现有预览图 renderer 的 HTML/CSS 合同，而是用 DSL 节点重新近似绘制了一套卡片。结果是默认预览持续出现宽度、比例、间距、叠放、头像、统计栏、类型标签等视觉差异。

本方案的目标不是继续修单个节点尺寸，而是把 v2 默认模板修成“严格遵循当前真实预览图渲染逻辑”的结构：默认节点必须复用现有 renderer 的 class、结构、数据处理和 CSS；新增自定义节点再走受控 generic renderer。

约束：

- 不重写 B 站链接解析、消息发送、Puppeteer 截图引擎。
- WebUI 预览和真实 QQ 推送继续走同一后端 renderer + Puppeteer 链路。
- 不允许任意 CSS/HTML/JS 输入。
- 不允许回退到 v1、禁用 v2、旁路旧 renderer 直接完成出图，或把异常模板静默 fallback 到旧默认图当成完成。
- 所有 `video/dynamic/article/live/bangumi/user` 类型必须在本轮完整闭环，不能只修某个类型或只修初始预览。
- 用户可编辑模板仍走后端 schema/normalizer 校验。
- 保持 `data-template-node-id`，并兼容旧 `data-layout-key`。

## 当前不一致清单

### 共享结构

1. `typeBadge`
   - 当前真实 renderer：`renderTypeBadge()` 输出 `.type-badge`，含图标、文本、充电标记、margin、padding、font-size、backdrop、text-shadow、高光边框。
   - v2 默认模板：普通 `tag` 节点，仅文本和简化样式；曾经还用 absolute 导致压住卡片。
   - 修复方向：`role: typeBadge` 必须使用 legacy type badge renderer 语义，不用 generic tag。

2. `card`
   - 当前真实 renderer：`.card` 由 `generateUnifiedCSS()` 控制，包含 `padding: var(--spacing-card)`、border、backdrop-filter、box-shadow、高光伪元素。
   - v2 默认模板：`.preview-template-card` 只包含 position/overflow，DSL 手写背景/圆角/阴影。
   - 修复方向：`role: card` 输出 `.card preview-template-card`，默认卡片样式完全由现有 `.card` CSS 接管；DSL patch 只作为受控 override。

3. `cover`
   - 当前真实 renderer：`<div class="cover-container"><img class="cover video/live/bangumi/article">`，比例和圆角由现有 CSS 控制。
   - v2 默认模板：普通 image 节点，没有 `cover-container` / `cover ${type}` class，尺寸曾写死。
   - 修复方向：`role: cover` 输出 legacy cover 结构，按 type 加 `cover video/live/bangumi/article`。

4. `content`
   - 当前真实 renderer：`.content`，统一 `padding: 24px; position: relative`。
   - v2 默认模板：普通 container，自带 DSL padding/gap。
   - 修复方向：`role: content` 输出 `.content`，默认 padding/position 由现有 CSS 接管。

5. `header/avatar/authorName/pubTime`
   - 当前真实 renderer：`header > header-left > avatar-wrapper + user-info`，头像、认证、挂件、等级、VIP 等依类型有专用 class。
   - v2 默认模板：avatar、authorName、pubTime 是普通 flex 兄弟节点。
   - 修复方向：`role: header` 使用 legacy header composer，按子节点 role 组装 `header-left/user-info/header-right`。

6. `title/text/stats`
   - 当前真实 renderer：`.title`、`.text-content`、`.stats`、`.video-stats`、`.article-stats`、`.action-bar`，并使用图标、emoji/richtext 组件和类型特定统计项。
   - v2 默认模板：普通文本和简化 stats，统计项为纯文本 `播放: 123`。
   - 修复方向：role-specific renderer 必须复用现有 formatter、icons、rich text/emoji 渲染路径；generic stats 只用于用户新增自定义统计栏。

### 类型差异

1. `video`
   - 必须复刻 `renderVideoContent()`：`cover -> content -> header -> title -> video-stats -> text-content`。
   - `pubTime` 包含发布时间和时长。
   - `stats` 使用 view/like/comment 图标与格式化数字。

2. `live`
   - 必须复刻 `renderLiveContent()`：cover、主播 header、`liveBadge` 嵌入作者名行、`roomId`、title、stats。
   - `liveBadge` 不能是普通 tag 的近似样式。

3. `bangumi`
   - 必须复刻 `renderBangumiContent()`：cover 3:4、title、`statusLine` 双 span、stats 四项、text-content。
   - `statusLine` 的 `status-prefix/status-meta` 不能丢。

4. `article`
   - 必须复刻 `renderArticleContent()`：content/header/header-right decorationCard、可选 cover、title、`article-excerpt`、`article-stats`。
   - 作者挂件、认证、等级、装扮卡片必须由现有逻辑渲染。

5. `dynamic`
   - 必须复刻 `renderDynamicContent()`：content/header、可选 decorationCard、title、text、origCard、media、embeddedResource、supplementalCards、action-bar。
   - `media/origCard/embeddedResource/supplementalCards` 必须调用现有组件 renderer，不允许用普通 image/text 占位替代。
   - blocked/charging dynamic 的分支也要保留。

6. `user`
   - 必须复刻 `renderUserContent()`：user header、头像挂件、等级/VIP/粉丝牌、signature、`user-stats`、最近动态 section。
   - `user-stats` 是四宫格，不是普通横向 stats。

## 总体修复策略

### 0. 明确实现边界

必须修改的核心模块：

- `src/services/previewTemplate/schema.js`
- `src/services/previewTemplate/defaults.js`
- `src/services/previewTemplate/normalizer.js`
- `src/services/previewTemplate/migrator.js`
- `src/services/previewTemplate/merge.js`
- `src/services/previewTemplate/renderer.js`
- `src/services/previewTemplate/css.js`
- `src/services/previewTemplate/bindings.js`
- `src/services/previewTemplate/metadata.js`
- `src/services/imageGenerator/generators/previewCard.js`
- `src/dashboard/routes/api/modules/preview-layout.js`
- `dashboard/src/pages/PreviewLayoutEditor.jsx`

禁止修改的边界：

- 不修改 B 站链接识别/解析入口。
- 不修改 QQ 消息发送和 NapCat 发送协议。
- 不替换 Puppeteer 截图方式。
- 不把主链路改成 Canvas 或前端截图。

### 1. 明确 renderer 分层

新增或调整 `src/services/previewTemplate/renderer.js`：

- `renderLegacyRoleNode(template, node, viewModel, context)`：处理默认角色节点。
- `renderGenericNode(template, node, viewModel, context)`：处理用户新增的 container/text/tag/image/stats/shape。
- `renderNode()` 根据 `node.role` 优先走 legacy role renderer；没有 legacy role 的新增节点走 generic renderer。

规则：

- 默认模板中的核心 roles 不再由 generic renderer 画。
- 默认核心 role 的首选实现不是复制一份近似 HTML，而是通过 legacy renderer adapter 复用现有 `renderVideoContent/renderDynamicContent/renderArticleContent/renderLiveContent/renderBangumiContent/renderUserContent` 及其子组件输出，然后按 `data-layout-key` 注入 `data-template-node-id` 与受控 override。
- 只有当某个 role 没有可直接复用的 legacy 输出片段时，才允许写 role-specific helper；helper 必须复用现有 formatter/icons/richtext/emoji/verify/media/resource/orig/supplemental 组件，不得手写近似视觉。
- 用户新增节点不会伪装成 legacy role，避免破坏核心合同。
- 所有节点输出 `data-template-node-id`。
- legacy role 同时输出 `data-layout-key`，保持旧 overlay/metadata 兼容。

### 2. 复用现有 renderer 数据与组件

`renderTemplateArtifacts()` 需要接收现有 renderer 所需上下文：

- `typeConfig`：用于类型标签 icon/label。
- `isCharging`：用于视频/动态充电标记。
- `emojiContext`：复用 `parseRichText()` 的 emoji 渲染。
- `showId`：用户卡 UID 开关。
- `groupId`：保留类型标签配置、夜间模式等逻辑入口。

`previewCard.buildPreviewRenderArtifacts()` 当前已经能创建 `emojiContext` 给旧 renderer；模板 renderer 也应接收同一个 context，而不是只构造 plain view model。

默认核心角色渲染建议路径：

1. 用当前类型 legacy renderer 生成类型内部 HTML。
2. 用安全 HTML 结构处理工具或受控字符串映射，仅针对已知 `data-layout-key` 注入 `data-template-node-id`。
3. 对隐藏、transform、size、order、style 等 DSL override 生成安全 CSS/结构调整。
4. 对新增 generic 节点，根据 `childrenByParentId` 插入到允许的容器 role 内。
5. 禁止处理用户提供 HTML；adapter 只处理本仓库 legacy renderer 生成的可信 HTML。

### 2.1 API 与存储合同

`/api/preview-layout/*` 的请求兼容窗口：

- `POST /preview-layout/preview`
  - 继续接受 `draftTemplate`。
  - 继续接受旧 `renderOverrides`，但必须在请求内迁移为 v2 role override 后渲染。
  - `draftTemplate` 与 `renderOverrides` 同时出现时返回 400，避免两个来源互相覆盖。
  - `draftTemplate` 校验失败时返回 400，不允许改走无模板旧分支生成一张“看似可用”的图。
  - 响应必须返回实际使用的 `template`、`container`、`elements` metadata。

- `POST /preview-layout/config`
  - 继续接受 `template`。
  - 继续接受旧 `patch`，但保存前必须迁移为 v2 template 或 v2 templatePatch。
  - `template` 与 `patch` 同时出现时返回 400，避免静默 `template` 胜出造成调用方误判。
  - 保存失败必须返回校验错误，不允许保存后运行时 fallback。

- `GET /preview-layout/config`
  - 返回 built-in parity 默认模板、global template、group template patch、effective template。
  - 如发现旧错误 v2 默认模板，读取时应迁移并返回迁移后的 effective template。

- `POST /preview-layout/reset`
  - reset 是显式用户操作，可以删除用户 override。
  - reset 不能作为实现正确性的必要前置；未 reset 的旧错误默认值也必须自动迁移或被校验拒绝。

存储结构：

- `previewLayoutConfig.version` 保持 `2`。
- `legacyV1Backup` 只作为备份，不参与运行时出图。
- `global[type].template` 保存完整 v2 template。
- `groups[groupId][type].templatePatch` 保存相对 global 的 v2 patch。
- `lastKnownGood` 不得作为静默运行时 fallback；如保留，只能作为迁移辅助和诊断字段。
- 不可迁移的持久化配置必须在读取/保存 API 中暴露明确错误，并阻止该配置进入真实发图链路；不得以 `lastKnownGood`、built-in template、legacy non-template renderer 或 v1 patch 作为运行时替代。

global/group override 语义：

- effective = built-in parity template + global full template override + group patch + draftTemplate。
- group patch 只能覆盖 group 显式改动，不能复制整份 global template。
- 修改 global 后，group patch 必须仍能应用到新 global；无法应用时必须校验失败并给出错误/迁移，而不是 fallback。
- group patch 的 rebase 以稳定 role/node id 为锚点；锚点缺失但可由 migrator 识别时自动迁移，无法识别时返回配置错误。
- group patch 必须是 field-level diff：
  - core role 的 patch 只能保存显式变更字段，例如 `visible/layout.transform/style.color/binding.source`。
  - 不允许把整份 core node 存进 group patch，避免 shadow 后续 global/default 的新增字段。
  - generic 新增节点可以保存完整 node，但必须包含 `componentType`、parent、policy 校验结果。
  - patch entry 必须记录 `baseSignature` 和 `baseNodeSignature`；应用时发现 base signature 不一致则执行 rebase。
  - rebase 成功：将 field-level 改动应用到新 global/default。
  - rebase 冲突：返回 `PREVIEW_TEMPLATE_REBASE_CONFLICT`，details 包含 `type/groupId/nodeId/field/baseSignature/currentSignature`。

### 2.1.1 no-fallback 运行时合同

本轮完成态只允许两类运行时结果：

1. 模板被成功校验/迁移，并由 v2 template renderer 输出真实预览图。
2. 模板被明确拒绝，API 返回错误或配置被标记为不可用，用户可见并可修复。

不允许出现第三类“静默成功”：

- 不允许 `getEffectiveTemplate()` 吞掉 group/global 模板错误后改用 `lastKnownGood`、built-in template 或旧 v1 patch。
- 不允许 `generatePreviewCard()` 在 template 失败后把 `draftTemplate` 置空并走 legacy non-template 分支。
- 不允许 dashboard preview 在 API 错误后展示旧图片并把它当成当前模板结果。
- 不允许 Docker/浏览器验收通过 reset、清空配置或换新数据目录来绕过旧配置迁移问题。

历史备份字段只用于诊断和迁移证据，不参与完成态渲染选择。

代码级改造清单：

- `getGlobalTemplate()` 不再读取 `lastKnownGood` 或 built-in 作为坏 global 的替代；没有 global 时才使用 built-in。
- `getEffectiveTemplate()` 应让 global/group/templatePatch 校验错误向调用方冒泡，并带上 type/groupId/source 信息。
- `generatePreviewCard()` 对 editable type 读取模板失败时不再继续生成旧图；应记录错误并抛出，使上游按现有错误处理链路处理该链接，保证“不发半坏旧图”。QQ 侧行为按现有 link preview 失败处理：不发送旧预览图；如当前链路已有错误提示能力，则发送明确错误提示，否则至少记录 `PREVIEW_TEMPLATE_*` 日志并跳过该预览。
- `/preview-layout/preview` 的模板错误返回明确错误，不返回旧图片。
- 现有 corrupt v2 fallback 到 `lastKnownGood` 的测试必须翻转为“抛错/返回明确错误”。

API 错误码矩阵：

| 场景 | HTTP status | `error/details.code` |
| --- | --- | --- |
| 请求 payload/schema 校验失败 | 400 | `PREVIEW_TEMPLATE_VALIDATION_FAILED` |
| `draftTemplate + renderOverrides` 或 `template + patch` 互斥冲突 | 400 | `PREVIEW_TEMPLATE_AMBIGUOUS_INPUT` |
| saved v2 无法无损迁移 | 422 | `PREVIEW_TEMPLATE_MIGRATION_FAILED` |
| group patch rebase 冲突 | 422 | `PREVIEW_TEMPLATE_REBASE_CONFLICT` |
| 必需 legacy role 缺失 | 422 | `PREVIEW_TEMPLATE_ROLE_MISSING` |
| 图片 URL/资源来源不受控 | 400 | `PREVIEW_TEMPLATE_UNSAFE_IMAGE` |

### 2.2 模板 patch 与迁移合同

v2 templatePatch 支持：

- `nodes[id].op = merge/add/remove/move/reorder/reset`
- `children[parentId]` 顺序 patch
- legacy core role 的 `layout/style/visible/binding` 安全 override
- generic 新增节点的完整节点定义

迁移规则：

- v1 `elements.{layout.offsetX,offsetY}` -> v2 `layout.transform.x/y`，保留 flow。
- v1 `layout.width/height/marginTop/marginBottom` -> 对应 role 的受控 override。
- v1 `typography/media` -> 对应 role 的受控 `style` 或 `layout.aspectRatio`。
- 旧错误 v2：
  - `typeBadge.layout.mode === absolute` 且符合旧默认值 -> 改为 legacy flow/default role。
  - `cover.layout.width === 1000 && height === 360` 或类似固定值 -> 移除固定宽高，交由 legacy `cover ${type}` class 控制。
  - core role 被拖成 absolute -> 转为 transform 或拒绝保存，不能让布局脱离文档流。
  - core role 上重复旧 CSS 的背景/圆角/阴影/字体近似值 -> 迁移为 “无默认 override”，仅保留用户明确改动。

saved v2 migrator：

- 增加默认模板 signature，例如 `previewTemplateDefaultSignature` 和 `previewTemplateSchemaVersion`，存储在 `previewLayoutConfig` 顶层以及每个 saved global/group entry 的 `baseSignature`。
- 旧错误默认模板识别条件：
  - 缺少本轮 signature；
  - core role 默认 class 不是 legacy adapter 合同；
  - `typeBadge` 为旧 absolute 或固定背景/字号/圆角；
  - `cover` 为固定 `1000x360`、`900x300`、`720x180` 等旧近似尺寸；
  - `card/content/header/title/stats` 上存在与旧 CSS 近似重画相关的默认 style。
- 无损转换：
  - 明显旧默认值直接删除 override，交由 legacy class 控制。
  - core role `absolute x/y` 转为 `layout.transform.x/y`，保留 flow。
  - width/height 仅在该 role allowlist 允许时迁移；否则移除或转为 role-specific safe override。
- 无法无损转换：
  - 返回 `PreviewTemplateValidationError`，错误 code 使用 `PREVIEW_TEMPLATE_MIGRATION_FAILED`，details 包含 `type/groupId/nodeId/reason`。
  - 读取 API 可返回错误详情；保存 API 必须拒绝；真实发图链路不得继续旧图。
- 持久化策略：
  - 读取时可以在内存中返回迁移后的 effective template。
  - 只有显式保存 global/group 时才写入迁移后的配置；不得在 GET 中偷偷重写用户配置文件。

### 2.3 core role 编辑矩阵

legacy core role 指默认模板中映射到当前真实 renderer 的节点，包括但不限于 `root/card/typeBadge/cover/content/header/avatar/authorName/pubTime/title/text/stats` 以及 `liveBadge/statusLine/media/origCard/embeddedResource/supplementalCards/dynamicSection`。用户卡四宫格统计不新增 `userStats` role，继续使用 `stats` role 并要求输出 `.stats.user-stats`。

| 操作 | legacy core role | generic 新增节点 |
| --- | --- | --- |
| 修改 `type/component/role` | 禁止 | 禁止伪装成 legacy role |
| 删除节点 | 必需 role 禁止；可选 role 只能设置 `visible:false` | 允许 |
| 改父级/reparent | 禁止 | 仅允许进入 schema 声明的容器 |
| 同级排序 | 仅允许在 legacy renderer 已支持的可选段落插入点排序；核心结构顺序由 renderer 决定 | 允许 |
| `layout.mode=absolute` | 禁止；旧 absolute 必须迁移为 flow + transform 或拒绝 | 允许 |
| transform 拖动 | 允许，保存为 `layout.transform`，不得改变文档流 | 允许 |
| resize | 只允许 safe allowlist 字段，例如 cover aspect/显式容器尺寸；不得覆盖 legacy 默认比例 | 允许 |
| style override | 只允许 schema allowlist 且必须是用户显式修改 | 允许 schema allowlist |
| binding | 只能在该 role 声明的 binding allowlist 内切换 | 允许安全 binding/static |

schema、normalizer、API 保存、属性面板和测试必须按上表实现；现有“core title 保存 absolute 成功”的测试应改为拒绝或安全转换断言。

schema 级真源：

- 在 `schema.js` 增加 `ROLE_POLICIES`，作为 normalizer、API 和前端属性面板共用的机器可读合同。
- 每个 type 的 policy 必须列出：
  - `requiredRoles`：不可删除、不可隐藏、不可 reparent，例如 `root/card/content` 以及该类型必需的 `cover/title/stats`。
  - `optionalRoles`：可 `visible:false`，但不可删除/reparent，例如 `text/decorationCard/medal/dynamicSection`。
  - `allowedParentByRole`：每个 role 的唯一或枚举父级。
  - `allowedChildrenByRole`：generic 节点可插入的容器 role，例如 `content/dynamicSection/card` 的受控插入点。
  - `layoutPolicy`：core role 禁止 `absolute`；允许 `transform` 的 role；允许 `width/height/aspectRatio` 的 role。
  - `stylePolicy`：允许覆盖的 style 字段；默认 style 不等于用户显式 override。
  - `bindingPolicy`：每个 role 可用 binding source allowlist。
- normalizer 必须拒绝未知 legacy role、重复 legacy role、core role 的非法 parent/order/remove/absolute。
- 前端属性面板只展示 policy 允许的字段；删除、复制、布局模式、宽高、绑定源按钮状态由 policy 控制。

### 2.4 legacy role mapping 表

adapter 不新增 HTML parser 依赖；使用本仓库 legacy renderer 输出的可信 HTML，并通过受控 `data-layout-key` 字符串映射注入 `data-template-node-id`。注入规则只匹配 `data-layout-key="<role>"`，不得处理用户输入 HTML。若某个必需 role 在 legacy HTML 中缺失，说明数据分支不可用或 renderer 合同不满足，adapter 必须按 role policy 判断：可选 role 可缺失，必需 role 抛出 `PREVIEW_TEMPLATE_ROLE_MISSING`。

共享 mapping：

| role/id | legacy selector / class | data-layout-key | v2 metadata |
| --- | --- | --- | --- |
| `root` | `.container` 外层内的 template body wrapper | `root` 由 adapter wrapper 输出 | `data-template-node-id="root"` |
| `typeBadge` | `.type-badge` | `typeBadge` | 注入到 `.type-badge` |
| `card` | `.card` | `card` | 注入到 `.card` |
| `cover` | `.cover-container`，内部 `.cover video/live/bangumi/article` | `cover` | 注入到 `.cover-container` |
| `content` | `.content` | `content` | 注入到 `.content` |
| `header` | `.header` | `header` | 注入到 `.header` |
| `avatar` | `.avatar-wrapper` | `avatar` | 注入到 wrapper，不注入到 img |
| `authorName` | `.user-name` / `.user-name--profile` | `authorName` | 注入到 name 节点 |
| `pubTime` | `.pub-time` | `pubTime` | 注入到 pub time 节点 |
| `title` | `.title` | `title` | 注入到 title 节点 |
| `text` | `.text-content` / `.article-excerpt` / `.user-sign` | `text` 或 `signature` | 按 role 注入 |
| `stats` | `.stats`, `.video-stats`, `.article-stats`, `.action-bar`, `.user-stats` | `stats` | 注入到统计/action 容器 |

逐类型 mapping：

| type | legacy 顺序 | 类型专属 role |
| --- | --- | --- |
| `video` | `typeBadge -> card -> cover -> content -> header -> title -> .stats.video-stats -> text` | `stats` 必须包含 `.video-stats` |
| `live` | `typeBadge -> card -> cover -> content -> header -> title -> stats` | `liveBadge` 注入到 header 内 `data-layout-key="liveBadge"`，`roomId` 注入到 `.pub-time[data-layout-key="roomId"]` |
| `bangumi` | `typeBadge -> card -> cover -> content -> title -> statusLine -> stats -> text` | `cover` 内 `.cover.bangumi`，`statusLine` 映射 `.status-line` |
| `article` | `typeBadge -> card -> content -> header -> decorationCard? -> cover? -> title -> article-excerpt -> .stats.article-stats` | `decorationCard` 可选，`cover` 可选但存在时必须 `.cover.article` |
| `dynamic` | `typeBadge -> card -> content -> header -> decorationCard? -> title? -> text/blocked -> origCard? -> media? -> embeddedResource? -> supplementalCards? -> .action-bar` | `media/origCard/embeddedResource/supplementalCards` 为可选 role；`stats` 继续映射 `.action-bar`，不新增 `actionBar` role |
| `user` | `typeBadge -> card -> content -> .header.user-header -> signature? -> .stats.user-stats -> dynamicSection?` | `stats` 继续映射 `.stats.user-stats`，不新增 `userStats` role；`uid/medal/signature/dynamicSection/dynamicText/dynamicMedia/supplementalCards` 为可选 role |

generic 插入点：

- `content`：允许插入 staticText/boundText/tag/imagePlaceholder/stats/shape/container。
- `card`：只允许插入绝对定位装饰型 generic 节点，默认不参与 core flow。
- `dynamicSection`：仅 user 类型允许插入 dynamic 相关 generic 节点。
- `header`：默认禁止 generic 插入，避免破坏 legacy header 结构；后续如开放必须新增 policy。

generic 节点插入通过 adapter 在目标容器结束标签前插入受控 HTML；若目标容器缺失，保存/预览失败，不静默丢弃。

### 3. 默认模板改为“结构合同”，不是“样式重画”

`src/services/previewTemplate/defaults.js` 需要调整：

- 保留节点树、可编辑 role、childrenByParentId 和绑定信息。
- 默认 style/layout 只保留可编辑必要值，不重复旧 CSS 已经定义的视觉样式。
- 核心节点的 class/结构由 role renderer 决定。

示例：

- `typeBadge`：保留 role 和 binding，不写自定义背景/字号/圆角。
- `card`：保留 role，不写自定义 card 背景/阴影。
- `cover`：保留 role 和 binding，不写死 width/height。
- `header`：保留 role 和子 role，不试图用 generic flex 拼出旧结构。
- `stats`：保留 role/items，但默认渲染走 type-specific stats renderer。

### 4. CSS override 只作用于受控节点

`src/services/previewTemplate/css.js` 需要区分：

- legacy 默认 class 的 base CSS 仍来自 `generateCSS()` / `generateUnifiedCSS()`。
- DSL layout/style 只生成安全 override，并作用在 `data-template-node-id` 上。
- 对 legacy role 的默认样式不重复生成；仅当用户显式修改属性时生成 override。
- transform 不应破坏文档流：非 absolute 节点拖动保存为 `transform`，absolute 节点保存 `x/y`。

### 4.1 escape 与图片 URL 策略

- generic renderer 继续对所有文本做 escape，对 binding 输出使用 safe view model，不读取任意对象路径。
- generic image 仅允许受控来源：`safeInternalImageUrl()` 返回的内置结构示例占位图、固定 asset id 映射出的仓库内只读资源、明确允许的 B 站 HTTPS 图片 URL。不得开放任意相对路径、本机路径、上传路径或协议相对 URL；用户输入的 `javascript:`、`data:`、内网 URL 一律拒绝。
- legacy adapter 只处理本仓库 renderer 产生的 HTML，不处理用户 HTML。
- 复用 legacy renderer 前必须审计本轮可达的外部文本插入路径，并补齐 escape：dynamic author name、user name、user signature、article/live/bangumi/video 中未经过 rich text parser 的标题/作者/描述字段都要确认。
- B 站 API 返回的图片 URL 与用户配置 URL 分开处理：legacy renderer 兼容现有 B 站图片 URL 规范；用户配置图片仍执行严格白名单。

### 5. Metadata 与 overlay 对齐

`src/services/previewTemplate/metadata.js` 继续收集 `[data-template-node-id]`。

必须保证：

- metadata box 来自真实 legacy class 渲染后的节点。
- WebUI overlay 按 `data-template-node-id` 对齐，不按虚构 DSL 尺寸。
- 默认未选中 overlay 不遮挡真实预览。
- 选中 `card/cover/content/header` 时的框要与真实元素外框一致。

## 具体实现分阶段

### Phase A：合同基线与测试夹具

1. 增加 renderer parity fixture：
   - video/live/bangumi/article/dynamic/user 各一份结构示例。
   - 对每种类型同时生成 legacy renderer 与 v2 template renderer 的 element metadata。

2. 增加核心几何断言：
   - `typeBadge.bottom <= card.top`。
   - video/live cover 宽度等于 card 内容区实际宽度，比例约 16:9。
   - bangumi cover 比例约 3:4。
   - content/header/title/stats/text 的纵向顺序与 legacy renderer 一致。
   - user stats 为四宫格区域，不是普通横排文本。
   - dynamic media/orig/resource/supplementalCards 的存在性与 legacy renderer 一致。

3. 增加 class 合同断言：
   - role 节点必须包含 legacy class，例如 `card`、`type-badge`、`cover-container`、`cover video`、`content`、`header`、`avatar-wrapper`、`title`、`stats`。
   - 必须覆盖 dynamic `media/origCard/embeddedResource/supplementalCards/action-bar/blocked`、user `.stats.user-stats`、article decoration、live badge、bangumi `status-line`。
   - 必须断言 template 分支保留 emoji/rich text、type badge charging 标记、verify badge、formatter 输出。

4. 增加 API 兼容断言：
   - `draftTemplate + renderOverrides` 返回 400。
   - `template + patch` 返回 400。
   - 旧 v1 patch/renderOverrides 可迁移为 v2 role override。
   - 持久化 corrupt v2 不得 fallback 到 `lastKnownGood` 并假装成功。

### Phase B：legacy adapter 与 role-specific renderer

1. 建立 legacy adapter：
   - 输入：`type`、规范化 template、B 站数据、`emojiContext`、`typeConfig`、`showId`、`groupId`。
   - 输出：复用现有 renderer 的 HTML，且每个可编辑 `data-layout-key` 元素带对应 `data-template-node-id`。
   - 需要覆盖 `typeBadge/card/cover/content/header/avatar/authorName/pubTime/title/text/stats` 及各类型专属 role。
   - adapter 不接受用户 HTML，不开放 HTML parser 给用户输入。

2. 对 adapter 难以覆盖但必须独立控制的节点，抽出 legacy role helpers：
   - `renderTypeBadgeRole()`
   - `renderCardRole()`
   - `renderCoverRole()`
   - `renderContentRole()`
   - `renderHeaderRole()`
   - `renderAvatarRole()`
   - `renderAuthorNameRole()`
   - `renderPubTimeRole()`
   - `renderTitleRole()`
   - `renderTextRole()`
   - `renderStatsRole()`
   - 类型专属：`renderLiveBadgeRole()`、`renderBangumiStatusLineRole()`、`renderDynamicMediaRole()`、`renderUserStatsAsStatsRole()` 等。

3. 对复杂类型优先复用现有组件：
   - dynamic media：`renderMediaHtml()`
   - dynamic embedded resource：`renderEmbeddedResourceCard()`
   - dynamic supplemental cards：`renderDynamicSupplementalCards()`
   - dynamic orig：`renderOrigContent()`
   - article decoration card、avatar frame、verify badge 复用现有 resolver。

4. generic renderer 只处理用户新增节点：
   - 静态文本
   - 绑定文本
   - tag
   - image placeholder
   - shape
   - 自定义 container/stats

### Phase C：默认模板收敛

1. 修改默认模板：
   - 删除核心 role 上重复/近似视觉样式。
   - 保留 role、binding、children 顺序和可编辑控制。
   - 多类型默认结构必须等价于当前 renderer。

2. 对默认模板加版本/签名：
   - 增加默认模板 signature，用于识别旧的半吊子默认模板。
   - 未保存用户改动时自动刷新到新默认模板。
   - 已保存用户模板必须迁移到 parity 默认模板结构；不得要求用户手工 reset 才能恢复正确默认。

### Phase D：迁移与兼容

1. v1 patch 迁移：
   - `data-layout-key` 到 `role` 映射不变。
   - v1 layout patch 迁移到对应 v2 role 的受控 override。
   - 不迁移旧半成品 v2 中明显来自错误默认值的 absolute/typeBadge/cover 固定宽高。

2. 已保存 v2 模板迁移：
   - 检测 `typeBadge.layout.mode === absolute` 且来自旧默认值时改为 flow。
   - 检测 `cover.layout.width === 1000 && height === 360` 时移除固定宽高，改为 type ratio。
   - 检测普通 flow 节点被拖成 absolute 且 role 是 legacy core 时自动改回 transform/flow；无法无损转换时拒绝保存并返回明确错误，不能要求用户 reset 才能恢复正确。

3. 错误处理（不允许回退）：
   - 读配置时发现旧 v1 patch 必须迁移到 v2 role override；不能继续按 v1 renderer 旁路出图。
   - 已保存 v2 模板如果是旧错误默认值，必须自动修正或迁移；不能静默保留错误结构。
   - 用户提交的异常模板必须被后端校验拒绝并返回明确错误；不能静默 fallback 到旧默认图并宣称完成。
   - 真实推送链路必须使用校验后的 v2 template renderer。若持久配置不可迁移，应记录错误并阻止保存该配置，而不是退回旧链路。
   - 可以保留 `legacyV1Backup` 作为数据备份和迁移证据，但不能作为运行时回退路径。

### Phase E：WebUI 行为修正

1. 初始预览：
   - 必须显示真实 legacy-equivalent 模板。
   - 不显示默认蓝色线框；仅 hover/选中显示 overlay。

2. 拖动/缩放：
   - 非 absolute legacy role 使用 transform，不破坏文档流。
   - resize cover/card/content 时必须重新生成后端截图验证。
   - 拖动后 metadata 与选框位置一致。

3. 属性面板：
   - 默认 role 显示“受 legacy 样式控制”的字段，只开放安全 override。
   - 对 card/typeBadge/cover 等核心节点，不展示会破坏旧合同的字段，或保存前做保护性转换。

4. 新增节点：
   - 新增节点可以是 generic，不要求等同 legacy。
   - 新增节点只能插入受控容器，不允许注入任意 HTML/CSS/JS。

## 测试计划

### 单测

- `test/unit/preview-template/preview-template-renderer.test.js`
  - legacy class 合同。
  - data-template-node-id + data-layout-key 合同。
  - generic 自定义节点 escape。

- `test/unit/preview-template/preview-template-schema.test.js`
  - 默认模板结构与 legacy roles 对齐。
  - 不再写死错误宽高/absolute。

- `test/unit/preview-template/preview-template-migrator.test.js`
  - v1 patch -> v2 role override。
  - 旧错误 v2 默认值迁移。

- `test/unit/dashboard/preview-layout-api.test.js`
  - draftTemplate 预览、保存、reset、group override。
  - 异常模板不会影响默认发图。
  - 必须改写旧断言：core `title.layout.mode = absolute` 不再保存成功；应断言 400 或 normalize 后为 flow + transform。
  - 必须新增互斥断言：`draftTemplate + renderOverrides` 400，`template + patch` 400。
  - 必须新增 corrupt persisted v2 断言：不再 fallback 到 `lastKnownGood`。

必须删除或翻转的旧测试合同：

- `test/unit/preview-template/preview-template-merge.test.js` 中“corrupt v2 fallback to lastKnownGood”改为抛出 template config error。
- `test/unit/dashboard/dashboard-preview-layout-api.test.js` 中保存 core role absolute 成功的断言改为拒绝或安全转换。
- `test/unit/preview-template/preview-template-renderer.test.js` 中只断言 generic `preview-template-*` class 的测试扩展为 legacy class parity；generic 安全测试保留但只覆盖新增节点。
- `test/unit/rendering/preview-template-rendering.test.js` 必须断言每种类型关键 legacy class 和 `data-template-node-id` 同时存在。

最小本地命令：

```bash
node --test test/unit/preview-template/*.test.js
node --test test/unit/dashboard/dashboard-preview-layout-api.test.js test/unit/dashboard/preview-layout-editor-source.test.js
node --test test/unit/rendering/preview-template-rendering.test.js test/unit/rendering/preview-layout-video-rendering.test.js
cd dashboard && npm run lint && npm run build
```

必要全量命令：

```bash
npm test
```

### 渲染测试

对 `video/dynamic/article/live/bangumi/user`：

- 结构示例 smoke。
- 真实链接 smoke。
- 保存全局/群组后真实推送图使用保存模板。
- metadata 与 overlay 对齐。
- 拖动/缩放后容器不塌缩。

### 浏览器 smoke

- `/preview-layout` 打开无报错。
- 初始预览接近当前默认预览图。
- hover/选中 overlay 不污染视觉。
- 拖动 `cover/title/card/typeBadge` 后重新预览不塌缩。
- 新增 tag/text/container 后保存、重载仍生效。
- 窄屏不溢出。

### Docker 验证

执行前先确认没有占用端口的旧容器；不得通过清空 `data/` 或 reset 模板绕过迁移问题。

命令 checklist：

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=120 bili-qq-bot
curl -f http://127.0.0.1:3000/
```

如当前环境使用旧 compose 命令，则以仓库 `CLAUDE.md` 的 `docker-compose up -d` / `docker-compose logs -f` 为准。

Docker 内验收：

- dashboard 首页可访问，`/preview-layout` 页面可访问且无前端报错。
- 调用 `/preview-layout` 相关 API 完成 video/dynamic/article/live/bangumi/user 结构示例预览。
- 保存 global template，重载后 effective template 仍生效。
- 保存 group templatePatch，切换 group 后覆盖生效，切回全局不污染。
- 对新增 tag/text/container/image placeholder/shape 做保存、重载、预览。
- 通过 preview-lab 或等价真实链接渲染路径验证保存模板影响真实出图链路。
- 查看容器日志，确认没有 template validation、Puppeteer 截图或 dashboard API 未处理异常。

## 验收标准

1. 默认模板在所有可编辑类型上与当前真实 renderer 的结构、class、主要几何关系一致。
2. 默认 WebUI 预览不再出现半成品视觉：无标签压封面、无卡片宽度错位、无封面比例错误、无拖动后塌缩。
3. 新增自定义节点不影响核心默认渲染合同。
4. 旧配置可迁移；异常配置被明确拒绝或标记为不可用，不得静默回退，不得生成半坏 QQ 发图。
5. 所有模板输入仍由后端校验，文本 escape，不开放任意 CSS/HTML/JS。

## 执行建议

这次不要继续按单点视觉 bug 修。应先完成 Phase A 的合同测试，再实现 Phase B/C。否则每修一个宽高，都会在另一种类型或交互上暴露新的结构偏差。
