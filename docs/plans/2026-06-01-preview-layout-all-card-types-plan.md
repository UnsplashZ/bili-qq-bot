# 预览编辑器全卡片类型扩展与交互修复方案

## 背景

本方案基于 2026-06-01 对当前工作区代码的只读复核。用户反馈集中在 WebUI `/preview-layout`：

1. 预览编辑器需要拓展到全部类型的卡片。
2. 编辑元素可见性后预览速度慢；关闭元素 A 并保存后，再关闭元素 B，预览图中仍显示元素 A，但实际推送正常关闭。
3. 元素列表内可见 / 隐藏标签显示异常：右侧开关已关闭，左侧仍显示“可见”。用户原文为“预算 tag”，结合截图和页面结构，按“元素列表 tag”处理。
4. 应用、保存、重置等按钮需要横向放到“预览图氛围色”区块下方、元素 / 画布 / 属性三栏上方。
5. 元素 / 画布 / 属性三个区块风格和其他 tag 风格不一致，需要统一。

当前实现是第一阶段视频闭环：

- `src/services/previewLayout/schema.js` 只有 `video` 为 `editable`，`dynamic/article/live/bangumi/user` 均为 `planned`。
- `src/dashboard/routes/api/modules/preview-layout.js` 在 config、reset、preview 中通过 `assertEditableVideo()` 拦截非 editable 类型。
- 结构示例模式中 `resolvePreviewTargetForRequest()` 明确只允许 `mockType === 'video'`，虽然 `src/services/previewLab/mockData.js` 已有多类型 mock 数据。
- 渲染层只有 `video` 的 `typeBadge`、`card` 和 renderer DOM 带 `data-layout-key`。其他 renderer 当前没有稳定布局 key，因此 override CSS 和元素 metadata 无法覆盖。

已确认的需求边界：

1. “全部类型”仅指 B 站链接解析的主卡片类型，不包括帮助、订阅列表等内部功能卡片。
2. 多类型扩展先做主元素级编辑，不深入到每张图片、每个投票选项、每个 opus link card 等子元素。
3. 可见性开关的体验目标是：左侧标签立即正确、画布明确显示更新中、最终预览图正确；本阶段不追求接近实时的拖拽 / 开关预览。

## 逐项判断

### 1. 全部类型卡片扩展

结论：可以做，但不是只改前端开关。需要补齐 schema、渲染 DOM 标记、结构示例、API 放行、测试。

建议纳入的第一批类型：

1. `video`
2. `dynamic`
3. `article`
4. `live`
5. `bangumi`
6. `user`

明确不纳入 `help_user`、`help_admin`、`subscription_list`。这些是帮助 / 列表类内部卡片，和 B 站链接解析预览的用户目标不一致，可后续单独评估。

类型元素建议：

| 类型 | 建议元素 key | 说明 |
| --- | --- | --- |
| 通用 | `typeBadge`, `card` | 所有主卡片统一提供，`typeBadge` 支持隐藏和文字布局，`card` 支持布局尺寸 |
| video | 现有 `cover`, `content`, `header`, `avatar`, `authorName`, `pubTime`, `title`, `stats`, `text` | 保持兼容 |
| dynamic | `content`, `header`, `avatar`, `authorName`, `pubTime`, `decorationCard`, `title`, `text`, `media`, `embeddedResource`, `supplementalCards`, `origCard`, `stats` | 动态结构多变，先覆盖主元素，不做任意子卡片深层编辑 |
| article | `content`, `header`, `avatar`, `authorName`, `pubTime`, `decorationCard`, `cover`, `title`, `text`, `stats` | 与 dynamic 共用部分 author/header 命名 |
| live | `cover`, `content`, `header`, `avatar`, `authorName`, `roomId`, `liveBadge`, `title`, `stats` | 直播间主结构较简单 |
| bangumi | `cover`, `content`, `title`, `statusLine`, `stats`, `text` | 无作者栏 |
| user | `content`, `header`, `avatar`, `authorName`, `uid`, `medal`, `signature`, `stats`, `dynamicSection`, `dynamicText`, `dynamicMedia`, `supplementalCards` | user 链路需单独复核 `src/services/link/linkTypes/user.js` |

### 2. 可见性预览慢与保存后预览滞后

结论：当前慢是预期架构成本，但可以优化交互；保存后预览滞后需要复现定位，优先怀疑前端状态与预览图生命周期没有同步。

当前每次预览都会走：

1. API resolve target。
2. 合并 saved override 与 temporary override。
3. `generatePreviewCardArtifacts()` 创建 Puppeteer page、注入 HTML、等待图片加载、截图。
4. 采集元素 metadata。

所以开关可见性后 700ms debounce 再截图，用户会看到慢反馈。这里不适合为了速度另写一套 Canvas 真源，但可以做两个层级优化：

1. 前端即时反馈：可见性开关后立即更新元素列表状态，并在旧预览图上给“预览更新中”状态，不再让旧 metadata 冒充当前状态。
2. 预览请求一致性：新开关动作发起后，旧请求结果不得覆盖新状态；当前图片对应的 payload 需要可追踪，避免旧图被当成最新图。
3. 可选后端缓存：结构示例和同一真实链接的 target 解析结果可短期复用，避免每次可见性微调都重新解析链接；预览渲染仍走真实 Puppeteer 截图。

本阶段验收不要求接近实时。只要做到左侧标签立即正确、画布显示更新中、最终预览图正确，即满足用户确认的体验目标。

保存后再改 B 仍显示 A 的排查路径：

1. 复现步骤固定为：生成预览 -> 关闭 A -> 应用预览 -> 保存 -> 关闭 B -> 等预览完成。
2. 在 preview 请求体中检查 `renderOverrides.elements.A.visible === false` 是否仍存在。
3. 在 preview 响应中检查 `layout.effective.elements.A.visible === false` 是否存在。
4. 在返回 HTML / CSS 中检查 `[data-layout-key="A"] { display: none !important; }` 是否存在。
5. 若 2-4 均存在但图片仍显示，查 renderer 是否有重复 DOM 未带同一个 `data-layout-key`，或 selector 指向了错误层级。
6. 若请求体缺失 A，则修前端 `saveConfig()` / `fetchConfig()` / `setDraftOverrides()` 的状态合并顺序。

### 3. 元素列表“可见 / 隐藏”标签错误

结论：这是明确的前端状态来源错误。

当前元素列表显示使用 `preview?.elements?.[key]` 的 metadata。metadata 只来自最近一次真实截图，用户刚关闭右侧开关时，左侧仍然读取旧预览结果，所以仍显示“可见”。

修复策略：

1. 元素列表状态优先读取当前草稿：`draftOverrides.elements[key].visible === false` 显示“隐藏”。
2. 若草稿未显式设置 visible，再回落到 `preview.elements[key]` 显示渲染态。
3. 标签文案区分两类状态：
   - 草稿明确隐藏：`隐藏`
   - 草稿明确显示：`可见`
   - 无草稿且预览元素缺失：`缺失`
   - 无草稿且预览尚未生成：`待预览`
4. `PreviewOverlay` 仍应使用真实 metadata，避免用草稿猜测坐标；但当草稿隐藏时可以不展示 overlay 热区，避免用户误点已经关闭的元素。
5. 开关后即使 Puppeteer 预览尚未完成，元素列表也必须立即反映草稿状态。

### 4. 操作按钮横向移动

结论：应从右侧属性面板中拆出一个统一操作栏。

目标位置：

1. 顶部筛选区
2. 预览图氛围色区块
3. 新增横向操作栏
4. 元素 / 预览画布 / 属性三栏

操作栏建议分组：

1. 主操作：`应用预览`
2. 保存：`保存到全局`、`保存到当前群`
3. 草稿：`重置草稿元素`
4. 危险重置：`重置已保存元素`、`重置当前模板`

行为要求：

- 保持现有 disabled 条件：全局保存仅全局模板可用，群保存仅选择群组后可用。
- 当前选中元素为空时，单元素重置按钮不可用。
- 危险按钮保留 danger 样式，但不要撑成大竖排。
- 移动端允许换行，但仍保持横向流式排列。

### 5. 元素 / 画布 / 属性风格统一

结论：应统一到现有 `Card` / `PanelHeader` 风格，减少三栏内部强边框和割裂感。

建议：

1. `PreviewLayoutEditor.jsx` 引入并使用 `Card`、`PanelHeader`，替代三栏手写的 header + border 组合。
2. 三栏外层保持同级 card，不再出现 card 内再包 card 的视觉效果。
3. Header 图标、字号、背景、边框使用 `PanelHeader` 规则，与其他 WebUI 面板一致。
4. 元素列表 item 使用更轻的选中态：`accent-surface` + 左侧细线或 subtle border，避免和属性卡片竞争。
5. 属性里的“显示元素”控件改成普通 field row，边框使用 `border-subtle`，不要形成独立大卡。

## 实施计划

### M1：复现与保护测试

1. 增加或扩展前端 / API 单测，覆盖元素列表状态优先读取草稿 visible。
2. 增加 preview-layout API 用例：结构示例允许多类型 mock，非支持类型仍拒绝。
3. 增加 renderer characterization：每个 editable 类型必须输出对应 `data-layout-key`。
4. 用一个最小真实或 mock preview 请求复现“保存 A 后再关闭 B”的预览滞后问题，并记录请求体、响应 layout、HTML/CSS 三点证据。
5. 增加请求乱序保护用例：后发 preview 请求完成前，先发请求的响应不得覆盖当前画布和状态。

### M2：schema 与 API 多类型开放

1. 在 `src/services/previewLayout/schema.js` 中增加各类型元素定义，把 `dynamic/article/live/bangumi/user` 改为 `editable`。
2. 将 `assertEditableVideo()` 重命名为 `assertEditableType()`，保持基于 `isEditableType(type)` 的判断。
3. 移除结构示例 `mockType !== 'video'` 限制，改为校验 `buildMockPreviewTarget(mockType)` 是否支持。
4. `getSavedEffectiveLayout()` 当前对非 editable 直接返回 `{}`，多类型开放后需确认实际发图链路会读取对应类型配置。
5. 明确 API 支持范围只覆盖 B 站链接解析主类型：`video/dynamic/article/live/bangumi/user`。

### M3：渲染器补稳定 layout key

1. `src/services/imageGenerator/generators/previewCard.js`
   - `typeBadge` 和 `card` 对所有 editable 类型都输出 `data-layout-key`，不再只限 `video`。
2. `src/services/imageGenerator/renderers/dynamic.js`
   - 给主内容、作者栏、头像、昵称、时间、装扮卡、标题、正文、媒体区、引用卡、补充卡、转发卡、统计栏补 key。
   - blocked dynamic 也尽量复用同一 key，避免充电专属场景失去编辑能力。
3. `article.js`、`live.js`、`bangumi.js`、`user.js`
   - 按 schema 元素 key 补 DOM 标记。
4. `src/services/previewLayout/css.js`
   - 现有 cover 子图规则目前只特殊处理 key 为 `cover` 的元素；对 user 动态媒体、动态媒体网格等图片容器要么沿用容器级 media 控制，要么增加受控的 `mediaTarget` 配置，避免 selector 误伤。

### M4：前端状态与操作栏重构

1. `dashboard/src/pages/PreviewLayoutEditor.jsx`
   - 元素列表状态改为草稿优先。
   - 开关变更时立即更新可见标签，并标记当前预览需要刷新。
   - 开关变更或保存成功后，画布进入“更新中 / 预览待更新”状态，直到最新 payload 的预览返回。
   - 保存成功后触发一次 silent preview，确保画布和 saved effective 对齐。
   - 保留 last payload / request id 防乱序逻辑，确保旧响应不会覆盖新预览。
   - 将属性面板底部按钮拆到 `PreviewActionBar`，放在氛围色区块下方。
   - 三栏改用统一 `Card` / `PanelHeader`。
2. 增加预览状态反馈：
   - `previewing` 时旧图上显示轻量遮罩或按钮 loading。
   - 若当前草稿与当前图片 payload 不一致，显示“预览待更新”状态。

### M5：验证与回归

自动验证：

```bash
npm test -- --grep "preview layout"
npm test -- --grep "preview-layout"
npm --prefix dashboard run lint
npm --prefix dashboard run build
```

渲染验证：

```bash
node test/tools/preview-lab.js "https://www.bilibili.com/video/BV..." --fresh --out-name preview-layout-video-check
node test/tools/preview-lab.js "https://t.bilibili.com/..." --fresh --out-name preview-layout-dynamic-check
node test/tools/preview-lab.js "https://www.bilibili.com/read/cv..." --fresh --out-name preview-layout-article-check
```

本地预览文件必须输出到 `test/output/`。

浏览器 smoke：

1. `/preview-layout` 浅色与深色模式。
2. 模板切换：video、dynamic、article、live、bangumi、user。
3. 关闭元素 A -> 应用预览 -> 保存 -> 关闭元素 B -> 等待预览完成，确认 A 和 B 均隐藏。
4. 关闭元素后，左侧标签立即从“可见”变为“隐藏”，画布显示更新中，最终截图与草稿一致。
5. 不同群组覆盖：全局隐藏 A，指定群恢复 A 或继续隐藏 B，确认实际预览与保存配置一致。
6. 移动端宽度下操作栏换行但不溢出，三栏顺序可读。

## 风险与边界

1. 动态卡片结构变化最大，先做主元素级编辑，不做所有内嵌卡片的深层单项编辑。
2. `user` 类型存在独立链接渲染路径，必须在实现时单独验证真实发图是否读取 layout 配置。
3. 可见性预览速度受 Puppeteer 截图限制，方案只优化状态反馈和输入复用，不改变图片生成真源。
4. 保存后的真实推送正常说明后端生效链路大概率没坏；本次重点是 WebUI preview 状态同步和 metadata 展示。
5. 所有非文档实现改动需要用户明确批准后再执行。
6. 本次不处理内部帮助卡片、订阅列表卡片，也不做子元素级深度编辑。

## 建议执行顺序

1. 先修元素列表状态和操作栏 / 三栏样式，这部分风险低、能直接解决 3-5。
2. 再复现并修保存后预览滞后，避免在多类型扩展中放大状态问题。
3. 最后扩展 B 站链接解析主卡片类型，按类型逐个补 schema、DOM key、测试和 smoke 截图。
