# 动态补充卡片图片布局与文字层级修正计划

## 摘要
- 目标：统一修正 `common` 小卡与引用资源卡的图片布局规则，确保图片贴左、按高度等比缩放、四角同规格圆角、圆角外露部分显示同一张卡片底色；同时将文本区字号统一到更大的可读规格。
- 真实样本：
  - `https://t.bilibili.com/1180607484445851667` 会走 `dynamic` 渲染，包含 `ADDITIONAL_TYPE_COMMON`
  - `https://www.bilibili.com/opus/1179264368735420423` 会解析为 `opus` 链接，但最终仍走 `dynamic` 预览渲染，包含 `opus_link_cards`

## 关键改动
- 仅修改样式层，不改数据契约、不改 HTML 结构，主改动集中在 `src/services/imageGenerator/core/theme.js`。
- `common` 小卡：
  - 将 `.embedded-resource-card--compact` 调整为 `height: 140px; min-height: 120px; max-height: 160px;`
  - 左侧图片区域取消固定宽度、取消左侧留白、取消额外背景；图片本身直接贴到卡片最左边
  - 紧凑封面容器显式改为 `width: auto`，避免继承基础样式里的 `width: 100%` 把文本区压成 `0`
  - 图片使用“高度填满容器、宽度按原比例自适应”的规则：实现语义为 `height: 100%`、`width: auto`、`aspect-ratio: auto`，不写死 `width/min-width/max-width`
  - 图片四角统一使用与卡片一致的圆角规格，默认沿用当前 `12px`
  - 图片圆角外露区域必须透出同一张卡片底色；图片外层不得再有异色底、边框、分隔线
  - 图片与文本之间的横向间距单独保留一个稳定值，由卡片容器或文本区内边距提供，不通过图片外层背景或描边制造分隔
  - 文本区统一：`badge/subtitle/desc/stat` 为 `14px`，`title` 为 `19px`
  - 标题、副标题、描述的现有单行截断策略保持不变
- 引用链接卡：
  - 将 `.opus-link-card` 调整为 `height: 140px; min-height: 120px; max-height: 160px;`
  - 与 `common` 小卡采用同一套图片规则：贴左、等比、满高、自适应宽度、四角同规格圆角
  - 封面容器去掉固定宽度、右侧分隔线、异色底；图片圆角外侧只能露出卡片自身底色
  - 卡片视觉底色统一在卡片根层提供，文本区背景改为透明，不再制造封面区和文本区颜色断层
  - 文本区统一：`meta/stat/desc` 为 `14px`，`title` 为 `19px`
  - `title/meta/stats/desc` 的现有排版策略保持不变，尤其不改 `opus-link-card-title` 的当前截断实现
- 渲染代码保持不变：
  - `src/services/imageGenerator/renderers/components/media.js` 与 `src/services/imageGenerator/renderers/components/opusLinkCard.js` 不改 DOM 结构
  - 不新增 class，不改 `renderEmbeddedResourceCard()` / `renderOpusLinkCard()` 的输出顺序或字段来源

## 接口与兼容性
- 无对外接口、数据结构、预览入口或调用方式变更。
- 变更仅影响动态补充卡片的视觉高度与图片圆角，不影响 `previewCard` 的类型路由和现有 `dynamicSupplementalCards` 组合顺序。

## 测试计划
- 单元测试：
  - 扩充 `test/unit/opus-link-card-style.test.js`，断言引用资源卡高度统一为默认 `140px`、范围 `120-160px`，封面区域不再写死固定宽度、不再有额外背景色，图片使用 `height: 100%`、`width: auto`、`aspect-ratio: auto`、显式四角圆角，文本区背景透明且字号符合统一规格
  - 更新 `test/unit/embedded-resource-card-style.test.js`，断言 `common` 小卡高度统一为默认 `140px`、范围 `120-160px`，左侧图片容器显式回到 `width: auto` 且不再写死 `min-width/max-width`，图片使用 `height: 100%`、`width: auto`、`aspect-ratio: auto`、显式四角圆角，图片外层无异色底且文本区字号符合统一规格
  - 保持 `test/unit/dynamic-supplemental-cards.test.js` 和 `test/unit/opus-link-card-rendering.test.js` 通过，确认 DOM 结构与卡片顺序未变
- 本地预览验收：
  - 串行运行 `node tools/preview-lab.js "https://t.bilibili.com/1180607484445851667" --fresh --out-name 2026-03-18-common-height-check`
  - 验收点：`common` 小卡高度明显放宽、内部图片有明确圆角、文本仍维持单行显示、无溢出
  - 串行运行 `node tools/preview-lab.js "https://www.bilibili.com/opus/1179264368735420423" --fresh --out-name 2026-03-18-opus-link-height-check`
  - 验收点：引用链接卡图片紧贴左侧、圆角外无异色底和分隔线、文本明显更易读且仍保持当前截断策略
  - 预览产物继续写入 `test/output/`

## 假设与默认值
- 用户已明确：不调整引用链接卡标题的行数策略，即使当前实现并非单行，也按“保持现状”执行。
- 两类卡片统一采用默认 `140px`、范围 `120-160px` 的高度包络；实现时不再引入额外分支尺寸。
- 为避免本地 Python 预览服务端口竞争，两个链接的 preview-lab 验证按串行执行，不并发跑。
