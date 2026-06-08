# WebUI 预览图布局编辑器完整设计方案

## 摘要

目标是在 WebUI 中新增一个“预览图布局编辑器”，允许用户基于真实 B 站链接或结构化示例，调整链接解析图片中关键元素的位置、大小、显示状态和部分视觉参数，并让保存后的配置影响后续 QQ 群实际发送的预览图。

推荐方案是复用现有 `preview-lab` 与 `imageGenerator` 链路，不重写渲染体系：

1. 继续使用现有 HTML/CSS 渲染 + Puppeteer 截图作为图片生成真源。
2. WebUI 负责提供可视化编辑、参数校验和预览。
3. 后端新增受控的 `previewLayoutConfig` 配置与 preview-layout API。
4. 渲染层通过稳定 `data-layout-key` 与受控 override CSS 应用用户配置。

## 背景

当前项目已经具备以下能力：

1. B 站链接解析与数据获取链路：
   - 链接识别、短链展开、类型分流由 `src/services/link/**` 负责。
   - Preview Lab 调试链路由 `src/services/previewLab/**` 负责。
   - `src/services/previewLab/targetResolver.js` 已能把链接解析为视频、动态、专栏、直播、番剧、用户等预览目标。
2. 图片生成链路：
   - `src/services/imageGenerator/generators/previewCard.js` 负责构建 HTML、注入 CSS、等待图片加载并通过 Puppeteer 截图。
   - `src/services/imageGenerator/renderers/**` 负责按类型输出卡片 DOM。
   - `src/services/imageGenerator/core/theme.js` 负责统一样式和 viewport。
3. WebUI 基础：
   - `dashboard/src` 是 React/Vite 管理面板。
   - `src/dashboard/routes/api/**` 是 Express API。
   - 当前设置页已经有预览图氛围色配置，但只支持颜色，不支持布局。
4. Preview Lab 基础：
   - `src/services/previewLab/session.js` 已经在 manifest/data payload 中保留 `renderOverrides` 字段。
   - 目前该字段只被记录，尚未真正传入渲染层生效。

因此，布局编辑器可以作为 Preview Lab 能力的产品化扩展，而不是另起一套 Canvas 图片编辑器。

## 当前实现复核结论

本方案基于当前工作区代码复核，以下事实是后续实现的约束：

1. Preview Lab 已经具备真实链接与结构示例两种入口：
   - `src/services/previewLab/inputResolver.js` 负责短链展开与链接识别。
   - `src/services/previewLab/targetResolver.js` 负责按链接类型调用 Python/B 站服务并返回 `cardType`。
   - `src/services/previewLab/mockData.js` 负责结构示例数据。
   - `src/services/previewLab/session.js` 会把 PNG/JSON/manifest/HTML 写入 `test/output` 或调用方指定目录。
2. `renderOverrides` 当前只被 Preview Lab 记录在 data payload / manifest 中，没有传入 `generatePreviewCardArtifacts`，因此现在不会影响渲染。
3. 图片生成真源是 `src/services/imageGenerator/generators/previewCard.js`：
   - `buildPreviewRenderArtifacts` 构建完整 HTML。
   - `generatePreviewCardArtifacts` 创建 Puppeteer page、注入 HTML、等待图片加载、对 `.container` 截图。
   - `generatePreviewCard` 只返回 base64，是真实发图链路的公共入口。
4. 普通链接发图接入点是 `src/services/link/linkRenderService.js`，它调用 `imageGenerator.generatePreviewCard(info, cardType, groupId)`。
5. 订阅推送接入点是 `src/services/subscription/updateChecker/modules/notify.js`，它调用同一个 `imageGenerator.generatePreviewCard(data, type, representativeGroupId, showId)`。
6. Dashboard API 在 `src/dashboard/routes/api/index.js` 中先挂载公开登录路由，再执行 `authenticateToken`，新增 preview-layout API 必须挂在鉴权之后。
7. 当前配置存储由 `src/config/schema.js`、`src/config/index.js`、`src/config/store.js` 管理，`lazyInit` 字段会在读取时把默认值写入 `_overrides`。`previewLayoutConfig` 不应使用 `lazyInit`，避免默认配置被隐式落盘。
8. 当前根项目没有 `npm run validate` 脚本；CI 的 validate job 实际由 `npm test`、Python pytest、dashboard lint、dashboard build 组成。
9. `user` 链接类型存在独立 `prepareRender`，不完全经过通用 `linkRenderService.prepare`。第一阶段只做 `video` 不受影响，但第二阶段扩展 `user` 时必须单独复核 `src/services/link/linkTypes/user.js`。

## 目标

1. 在 WebUI 新增预览图布局编辑器页面。
2. 支持输入真实 B 站链接，生成当前渲染效果并进入编辑状态。
3. 支持选择结构化示例，脱离外部 B 站数据也能调试模板。
4. 支持调整关键元素：
   - 显示/隐藏
   - 宽高
   - 上下左右偏移或间距
   - 字号、行数/最大高度
   - 封面裁切方式和比例
5. 支持全局模板与群组覆盖：
   - 默认使用全局模板。
   - 指定群组可覆盖局部配置。
6. 保存后的配置应影响后续真实消息发送的预览图。
7. 提供一键重置单元素、单类型模板、全部模板的能力。
8. 保留稳定回退：配置异常时回退默认样式，不中断图片生成。

## 非目标

1. 不重写图片生成链路为 Canvas、SVG 或前端截图。
2. 不允许用户输入任意 CSS。
3. 不做完整设计器能力，例如图层自由组合、任意文本新增、任意图片上传。
4. 不改变 B 站数据获取、链接类型判定和消息发送协议。
5. 不在第一阶段支持每条链接独立保存布局。
6. 不把布局编辑器放进现有系统设置页作为小弹窗；它应是独立工具页。
7. 不默认改变历史卡片样式；无配置时输出必须保持当前效果。

## 用户场景

### 场景 1：全局调整视频卡片封面高度

用户希望所有视频预览图封面更矮，标题更靠上。

流程：

1. 打开 WebUI 的“预览编辑器”。
2. 输入一个视频链接。
3. 点击生成预览。
4. 选中封面元素。
5. 调整封面高度或比例。
6. 保存到全局模板。
7. 后续群里解析视频链接时使用新布局。

### 场景 2：某个群单独隐藏统计栏

用户希望某个群的预览图更简洁，不显示播放、点赞、评论统计。

流程：

1. 选择目标群。
2. 选择视频模板。
3. 关闭 `stats` 元素显示。
4. 保存为群组覆盖。
5. 其他群保持全局默认。

### 场景 3：动态长正文调高展示区域

用户希望动态卡片正文最多展示更多内容。

流程：

1. 选择动态结构示例或输入真实动态链接。
2. 选中正文元素。
3. 调整最大高度或行数。
4. 预览确认无明显遮挡。
5. 保存。

## 总体架构

### 推荐架构

```text
WebUI Editor
  |
  | POST /api/preview-layout/preview
  v
Dashboard API
  |
  | resolvePreviewInput / resolvePreviewTarget
  v
Preview Target
  |
  | generatePreviewCardArtifacts(data, type, groupId, showId, options)
  v
Image Generator
  |
  | renderer outputs data-layout-key DOM
  | theme appends override CSS
  v
Puppeteer Screenshot
  |
  v
Preview PNG + element metadata
```

### 核心原则

1. 图片渲染真源仍在后端 `imageGenerator`。
2. 前端编辑器看到的是后端生成的真实结果，不是一个“近似模拟器”。
3. 用户配置只通过白名单 schema 转换为 CSS 变量或受控 CSS 规则。
4. 默认样式和用户 override 分层：
   - 默认样式：`theme.js` 与 renderer 当前逻辑。
   - 用户 override：新增 `previewLayoutConfig`。
   - 临时预览 override：仅本次 `POST /preview` 生效。

## 第一阶段落地范围

第一阶段只要求 `video` 类型完整闭环，闭环定义为：

1. schema/normalizer/merge/css/metadata 能覆盖 `video`。
2. `video` renderer 补稳定 `data-layout-key`。
3. Preview Lab 与 dashboard preview API 的临时 `renderOverrides` 能真实影响 `video` PNG。
4. 保存全局或群组 `video` 配置后，普通链接解析发图和订阅推送都使用同一 effective layout。
5. WebUI `/preview-layout` 支持真实视频链接和 video 结构示例。
6. 无配置时 `video` 真实发图行为保持兼容。

第一阶段只补 schema 占位或延后的类型：

1. `dynamic`：可在 reviewer 确认 video 闭环稳定后扩展。原因是动态有正文、媒体、多图、转发、资源卡、投票卡等多形态，DOM key 和 metadata 口径更复杂。
2. `article`：可在 reviewer 确认后扩展。原因是专栏有懒加载图片、正文截断、文章模式样式。
3. `live` / `bangumi` / `user`：第一阶段不要求完整编辑闭环。如实现成本低，可只在 schema 中标记 `status: "planned"`，不开放保存。
4. 其他类型统一延后。

实施中如果发现 `dynamic/article/live/bangumi/user` 的 DOM key 改动风险高，必须保持延后，不得为了看起来“支持更多类型”而扩大第一阶段真实发图影响面。

## 数据模型

### 顶层配置

新增配置建议命名为 `previewLayoutConfig`。

```json
{
  "version": 1,
  "global": {
    "video": {
      "elements": {}
    },
    "dynamic": {
      "elements": {}
    },
    "article": {
      "elements": {}
    }
  },
  "groups": {
    "123456789": {
      "video": {
        "elements": {}
      }
    }
  }
}
```

说明：

1. `global` 是默认模板。
2. `groups[groupId]` 是群组覆盖。
3. 合并顺序：内置默认样式 -> `global[type]` -> `groups[groupId][type]` -> 本次临时预览 override。
4. 未配置字段不写入，避免配置膨胀。

### 模板类型

第一阶段完整支持：

1. `video`

第一阶段 schema 可声明但默认不可编辑：

1. `dynamic`
2. `article`
3. `live`
4. `bangumi`
5. `user`

第二阶段再评估：

1. `favorite_list`
2. `audio`
3. `topic`
4. `channel_series`
5. `article_list`
6. `note`
7. `cheese_video`

### 元素 Key

`video` 第一阶段元素：

```json
[
  "typeBadge",
  "card",
  "cover",
  "content",
  "header",
  "avatar",
  "authorName",
  "pubTime",
  "title",
  "stats",
  "text"
]
```

后续类型可复用的通用候选元素：

```json
[
  "typeBadge",
  "card",
  "header",
  "avatar",
  "avatarFrame",
  "authorName",
  "pubTime",
  "title",
  "text",
  "cover",
  "media",
  "stats",
  "actionBar",
  "embeddedResource",
  "supplementalCards"
]
```

不同模板只暴露实际存在的元素。前端应以 `/schema` 返回的模板能力为准，不硬编码全部控件。

第一阶段 `video` 元素稳定规则：

1. `cover` 绑定 `.cover-container`，不是内部 `img`。
2. `avatar` 绑定 `.avatar-wrapper`，避免单独移动头像图后认证角标脱离。
3. `authorName` 绑定昵称文本节点。
4. `pubTime` 绑定发布时间/时长文本节点。
5. `stats` 绑定 `.video-stats` 容器。
6. `text` 仅在视频简介存在时出现；metadata 中可以不存在，前端必须容忍。

### 元素配置

```json
{
  "visible": true,
  "layout": {
    "mode": "flow",
    "offsetX": 0,
    "offsetY": 0,
    "width": null,
    "height": null,
    "marginTop": null,
    "marginBottom": null
  },
  "typography": {
    "fontSize": null,
    "lineHeight": null,
    "maxLines": null,
    "maxHeight": null
  },
  "media": {
    "aspectRatio": null,
    "objectFit": null,
    "objectPosition": null,
    "borderRadius": null
  }
}
```

字段说明：

1. `visible`：是否显示元素。
2. `layout.mode`：
   - 第一阶段只支持 `flow`。
   - 第二阶段可对少数元素开放 `absolute`。
3. `offsetX/offsetY`：在流式布局中使用 transform 做轻微偏移。
4. `width/height`：限制在安全范围内。
5. `typography`：仅对文本元素生效。
6. `media`：仅对图片/封面/媒体元素生效。

### 安全范围

第一阶段限制：

1. `offsetX`: `-120` 到 `120`
2. `offsetY`: `-120` 到 `120`
3. `width`: `80` 到 `1200`
4. `height`: `40` 到 `1600`
5. `marginTop/marginBottom`: `-80` 到 `160`
6. `fontSize`: `12` 到 `72`
7. `lineHeight`: `1.0` 到 `2.4`
8. `maxLines`: `1` 到 `30`
9. `maxHeight`: `40` 到 `2400`
10. `borderRadius`: `0` 到 `32`
11. `objectFit`: `cover` / `contain` / `fill`
12. `objectPosition`: 预设枚举，例如 `top`、`center`、`bottom`

未知字段与越界处理：

1. 保存配置时，未知类型、未知元素、未知字段、未知 enum 必须返回 400，不静默保存。
2. 临时预览时，未知字段同样返回 400，避免 WebUI 草稿和真实保存行为不一致。
3. 数值字段第一阶段采用“拒绝越界”而不是自动 clamp；前端控件可 clamp，但后端仍必须独立校验。
4. `null` 表示移除该字段 override；空对象应由 normalizer 清理。
5. 请求体序列化后超过 `64KB` 必须返回 413 或 400，不进入渲染。
6. 任意 CSS 字符串、selector、style 文本、url、className 不属于 schema，必须拒绝。
7. 只有真实发图链路读取“已保存配置”时允许容错：如果磁盘中已有历史/手工损坏配置，记录 warn 并回退默认 layout；这不适用于 dashboard 保存 API 和 preview API。

## 后端设计

### 新增模块

建议新增：

1. `src/services/previewLayout/`
   - `schema.js`
   - `normalizer.js`
   - `merge.js`
   - `css.js`
   - `elementMetadata.js`
2. `src/dashboard/routes/api/modules/preview-layout.js`

### API 设计

#### `GET /api/preview-layout/schema`

返回编辑器支持的模板、元素和字段范围。

响应示例：

```json
{
  "version": 1,
  "types": {
    "video": {
      "label": "视频",
      "status": "editable",
      "elements": {
        "cover": {
          "label": "封面",
          "controls": ["visible", "layout", "media"]
        },
        "title": {
          "label": "标题",
          "controls": ["visible", "layout", "typography"]
        }
      }
    }
  },
  "limits": {}
}
```

`dynamic/article/live/bangumi/user` 如果第一阶段未完整实现，应返回 `status: "planned"` 或不出现在 `editableTypes` 中，前端不能允许保存。

#### `GET /api/preview-layout/config`

读取当前配置。

查询参数：

1. `groupId` 可选。
2. `type` 可选。

响应包含：

1. `global`
2. `group`
3. `effective`
4. `scopeMeta`，用于标识当前是否存在群组覆盖。

读取配置不得创建默认配置落盘。无配置时应返回空对象与内置 schema 默认能力。

#### `POST /api/preview-layout/config`

保存配置。

请求体：

```json
{
  "scope": "global",
  "groupId": null,
  "type": "video",
  "patch": {
    "elements": {
      "cover": {
        "layout": {
          "height": 420
        }
      }
    }
  }
}
```

校验要求：

1. `scope` 只能是 `global` 或 `group`。
2. `scope=group` 时必须有合法 `groupId`。
3. `type` 必须是支持的模板类型。
4. `patch` 必须通过 schema normalizer。
5. 不允许保存未知元素、未知字段、未知 CSS 属性。
6. 请求体最大 `64KB`。
7. 只保存用户修改字段；字段恢复默认后应从配置中删除，而不是保存默认值。
8. 保存后清理空对象；如果某个 type 下没有任何元素 override，则删除该 type 节点。

#### `POST /api/preview-layout/preview`

生成临时预览。

请求体：

```json
{
  "mode": "link",
  "input": "https://www.bilibili.com/video/BV...",
  "groupId": "123456789",
  "mockType": "video",
  "showId": true,
  "cacheMode": "cached",
  "renderOverrides": {
    "elements": {}
  }
}
```

响应：

```json
{
  "status": "success",
  "image": {
    "base64": "...",
    "mime": "image/png"
  },
  "resolved": {
    "cardType": "video",
    "canonicalUrl": "https://www.bilibili.com/video/BV..."
  },
  "debugMeta": {},
  "elements": {
    "cover": {
      "exists": true,
      "box": { "x": 0, "y": 0, "width": 1000, "height": 562 }
    }
  }
}
```

规则：

1. `mode=link` 时必须有 `input`，由现有 `resolvePreviewInput` 和 `resolvePreviewTarget` 决定真实 `cardType`。前端传入的 `mockType` 不得覆盖真实解析结果。
2. `mode=structure` 时必须有 `mockType=video`。第一阶段只允许 `video` 结构示例进入编辑。
3. preview API 默认不写 PNG/JSON/HTML 文件，只返回 base64 和 metadata；只有 Preview Lab CLI/Web 调试继续写入 `test/output/`。
4. preview API 必须走 dashboard 鉴权，不允许新增公开入口。
5. 预览时合并顺序为：内置默认 -> 已保存 global -> 已保存 group -> 本次 `renderOverrides`。

#### `POST /api/preview-layout/reset`

重置配置。

请求体：

```json
{
  "scope": "group",
  "groupId": "123456789",
  "type": "video",
  "element": "cover"
}
```

支持粒度：

1. 单元素
2. 单类型
3. 单群组
4. 全局全部类型

全局全部类型重置应要求前端二次确认。

第一阶段 reset 粒度：

1. `scope=global,type=video,element=<key>`：重置全局 video 单元素。
2. `scope=global,type=video`：重置全局 video。
3. `scope=group,groupId,type=video,element=<key>`：重置群组 video 单元素。
4. `scope=group,groupId,type=video`：重置群组 video。
5. 不在第一阶段提供全局全部类型后端 shortcut；前端如需“全部重置”，应逐 type 调用或等第二阶段。

## 渲染层设计

### 函数签名调整

当前：

```js
generatePreviewCardArtifacts(data, type, groupId, showId)
```

建议：

```js
generatePreviewCardArtifacts(data, type, groupId, showId, options)
```

`options` 包含：

```js
{
  renderOverrides: {},
  collectElementMetadata: false
}
```

兼容要求：

1. 旧调用不传 `options` 时行为不变。
2. `options` 默认为空对象，内部只读取已知字段。
3. `generatePreviewCard(data, type, groupId, showId)` 内部按 `groupId + type` 读取已保存 effective layout 并传入。
4. Preview API 可额外传入临时 override。
5. Preview Lab 调用必须把 `options.renderOverrides` 传入；当前只记录不生效的行为需要修正。
6. 特殊生成器如帮助菜单、订阅列表不接入 layout override。

### DOM 标识

renderer 输出关键节点时补充：

```html
<div class="cover-container" data-layout-key="cover">
  <img class="cover video" ...>
</div>
```

要求：

1. `data-layout-key` 稳定，不随 class 重命名变化。
2. 一个 key 在同一卡片中尽量唯一。
3. 对重复项使用后缀或分组：
   - `media`
   - `media.0`
   - `media.1`
4. 第一阶段只编辑唯一元素，重复媒体图先整体编辑 `media` 容器。
5. 第一阶段只修改 `video` renderer DOM；其他 renderer 的 `data-layout-key` 必须等独立 review 后再扩展。
6. 增加 `data-layout-key` 本身不得改变默认样式或布局。

### Override CSS 生成

新增 `buildPreviewLayoutOverrideCss(effectiveConfig)`。

输出示例：

```css
[data-layout-key="cover"] {
  height: 420px;
  transform: translate(0px, -12px);
}

[data-layout-key="title"] {
  font-size: 38px;
  max-height: calc(1.5em * 3);
  overflow: hidden;
}

[data-layout-key="stats"] {
  display: none !important;
}
```

规则：

1. CSS 只能由受控 schema 生成。
2. 不拼接用户原始 CSS 字符串。
3. `display: none` 只用于 `visible=false`。
4. `!important` 只在必要字段使用，避免破坏默认样式维护。

### 元素元数据采集

预览 API 需要知道元素在截图中的位置，用于前端 overlay。

在 Puppeteer `setContent` 后、截图前执行：

```js
document.querySelectorAll('[data-layout-key]')
```

返回：

1. `exists`
2. `x`
3. `y`
4. `width`
5. `height`
6. `visible`
7. `className`

坐标应相对 `.container`，不是浏览器 viewport。

坐标口径：

1. `x/y/width/height` 使用 `getBoundingClientRect()`。
2. container rect 作为原点，`x = element.left - container.left`，`y = element.top - container.top`。
3. `visible=false` 或 `display:none` 的元素可返回 `exists=true, visible=false, box=null`。
4. DOM 中不存在的可编辑元素返回 `exists=false`，前端禁用相关控件。
5. screenshot 的底图就是同一个 `.container`，前端 overlay 按底图自然尺寸等比例缩放。

## 前端设计

### 新增页面

建议路径：

1. 路由：`/preview-layout`
2. 页面文件：`dashboard/src/pages/PreviewLayoutEditor.jsx`
3. 组件目录：`dashboard/src/pages/preview-layout/components/**`
4. Hook：`dashboard/src/pages/preview-layout/hooks/**`
5. 工具：`dashboard/src/pages/preview-layout/utils/**`

导航放入“诊断”或新增“工具”分组。推荐放入“诊断”，名称为 `预览编辑器`。

第一阶段页面仅开放 `video` 类型的保存和重置。其他类型如果出现在下拉中，必须标记为“暂未开放”并禁用编辑。

### 页面布局

桌面端：

1. 顶部工具条：
   - 模式：真实链接 / 结构示例
   - 链接输入框
   - 群组选择
   - 模板类型
   - 生成预览
   - 保存
   - 重置
2. 主区域三栏：
   - 左侧：元素列表
   - 中间：预览画布
   - 右侧：属性面板

移动端：

1. 顶部保留输入与生成按钮。
2. 预览在上。
3. 元素列表与属性面板用 tabs 切换。
4. 控件不能覆盖预览图；移动端不启用复杂拖拽缩放，先以数值控件为主。
5. 所有按钮文本必须在小屏可换行或缩短，不允许横向溢出。

### 预览画布

第一阶段建议使用后端返回的 PNG 作为底图，再叠加透明 overlay：

1. `<img>` 展示真实预览图。
2. overlay 层按 `elements[key].box` 绘制可选中边框。
3. 用户拖拽或缩放后只更新本地 `draftOverrides`。
4. 停止拖拽后 debounce 调用 `/preview` 重新生成真实图。

这样做的优点：

1. 视觉结果和最终发图一致。
2. 不需要在前端复刻复杂 CSS。
3. 对 Puppeteer 真实截图链路有持续验证价值。

### 属性面板

根据元素能力动态显示控件。

基础控件：

1. 显示开关
2. X/Y 偏移 stepper
3. 宽/高输入
4. 上下间距输入
5. 字号 slider + 输入
6. 最大行数或最大高度
7. 图片裁切方式菜单
8. 图片对齐菜单
9. 圆角输入

按钮：

1. `应用预览`
2. `重置此元素`
3. `保存到全局`
4. `保存到当前群`

### 交互策略

1. 编辑草稿与已保存配置分离。
2. 页面加载后读取 `effective` 配置作为草稿初始值。
3. 修改控件立即更新 overlay，debounce 后生成真实预览。
4. 生成失败时保留旧图并显示错误。
5. 保存成功后重新拉取配置，避免本地状态与后端不一致。
6. 处于群组上下文时不允许直接 `保存到全局`；如需修改全局模板，必须先切回 `全局模板`，避免把群组覆盖合并后的 effective 草稿写入全局配置。

### 状态提示

需要明确区分：

1. `未保存`
2. `正在生成预览`
3. `预览失败`
4. `保存成功`
5. `使用群组覆盖`
6. `继承全局`
7. `当前类型暂未开放`
8. `重置后待保存`

## 配置存储方案

### 方案 A：并入 `config/config.json`

优点：

1. 复用现有 config save 机制。
2. dashboard 配置读取路径一致。
3. 部署和备份简单。

缺点：

1. 配置可能较大。
2. 需要扩展 schema 和 dashboard snapshot。

### 方案 B：独立 `data/preview-layout-config.json`

优点：

1. 和核心 bot 配置解耦。
2. 未来可单独导入/导出模板。
3. 文件较大时不污染 `config/config.json`。

缺点：

1. 新增存储模块。
2. 需要额外备份策略。

### 推荐

第一阶段推荐方案 A，并控制配置规模：

1. 只保存用户修改过的字段。
2. 默认配置不落盘。
3. 后端 normalizer 清理空对象。
4. `previewLayoutConfig` 在 `src/config/schema.js` 中不得使用 `lazyInit`。
5. 读取时应通过 helper 返回深拷贝，不能把默认对象引用暴露给调用方修改。
6. `getDashboardConfigSnapshot()` 不需要默认包含完整 layout 配置；preview-layout API 单独读取，避免系统设置页无关加载。

如果后续支持大量模板导入/导出，再迁移到独立文件。

## 实际发图链路接入

需要确保不仅 WebUI 预览生效，真实消息发送也生效。

接入点：

1. `src/services/link/linkRenderService.js`
   - 调用 `imageGenerator.generatePreviewCard(info, cardType, groupId)`。
   - `generatePreviewCard` 内部应按 `groupId + cardType` 读取 effective layout。
2. `src/services/subscription/updateChecker/modules/notify.js`
   - 订阅推送同样调用 `imageGenerator.generatePreviewCard`。
   - 应自动受同一配置影响。
3. Preview Lab：
   - CLI/Web 调试可以传临时 `renderOverrides`。
   - 未传时可以读取已保存配置。

### 订阅推送分组修正

当前订阅推送会按 `night/showId/showLabel` 分组，并使用每组第一个群作为 representative group 生成一张图后群发。引入群组 layout 覆盖后，这个分组 key 必须纳入 layout signature，否则不同 layout 的群可能共用同一张图。

第一阶段实现要求：

1. 新增 helper，例如 `getPreviewLayoutSignature(type, groupId)`。
2. signature 输入必须是 normalizer 后的 effective layout，仅包含真正生效的用户 override 字段。
3. 无 layout override 时 signature 固定为 `default`。
4. 订阅推送分组 key 从：
   - `night:${isNight}_showId:${showId}_showLabel:${showLabel}`
   改为：
   - `night:${isNight}_showId:${showId}_showLabel:${showLabel}_layout:${layoutSignature}`
5. 同一批 `targetGroupIds` 内的群必须具有相同 effective layout；此时继续使用 representative group 生成图片是安全的。
6. 如果 signature 计算失败，记录 warn，并对该群使用 `default` signature 和默认 layout，不得把损坏配置传播给同批其他群。
7. 不推荐第一阶段直接“每群生成一张图”，因为会显著增加 Puppeteer 截图次数；按 layout signature 重新分批能保持现有批处理优势。

验收必须覆盖：

1. A 群有 `video` group override、B 群无 override 时，二者不在同一个订阅渲染批次。
2. 两个群 effective layout 完全一致时仍可共用同一张图。

回退策略：

1. effective layout 为空时，不向 CSS 追加任何 override。
2. normalizer 报错时，真实发图链路不得抛出配置错误导致发图失败；应记录 warn 并回退默认样式。
3. 渲染器或 Puppeteer 异常仍沿用现有 fallback text。
4. 配置只影响布局，不影响 B 站取数、链接类型判定、canonical URL、缓存 key 或消息发送协议。

## 权限与安全

1. 所有 preview-layout API 必须走现有 dashboard 鉴权。
2. 不新增公开未鉴权预览接口。
3. 输入链接沿用现有解析与缓存策略。
4. `renderOverrides` 必须限制 JSON size，例如最大 `64KB`。
5. 后端只接受 schema 中定义的 key。
6. CSS 由后端生成，不接受用户提供 CSS 字符串。
7. 文件输出仍遵守测试产物规则，正式 API 默认不把临时预览写入非必要文件。

## 性能设计

风险点：

1. 每次拖拽都触发 Puppeteer 截图会很慢。
2. B 站真实链接取数可能受网络和 cookie 影响。
3. 多用户同时预览会占用浏览器池。

控制策略：

1. 前端拖拽时只更新 overlay，停止拖拽后 debounce 生成真实预览。
2. 默认 `cacheMode=cached`。
3. API 加 busy/并发保护或复用 browserManager 当前队列。
4. 预览 API 返回 base64，不默认写文件。
5. 结构示例模式用于快速调样式，减少外部数据依赖。

## 兼容与回退

1. 无 `previewLayoutConfig` 时行为完全等同当前版本。
2. 真实发图读取已保存配置解析失败时：
   - 记录日志。
   - 丢弃异常字段或整段损坏 layout。
   - 使用默认样式继续渲染。
3. dashboard 保存 API 和 preview API 的非法输入不走该容错路径，必须直接拒绝。
4. 单元素配置异常时，只跳过该元素。
5. Preview API 失败不影响 bot 运行。
6. 真实发图失败时仍沿用当前 fallback text 逻辑。

## 实施计划

### M1：文档与 schema 基础

1. 新增本设计文档。
2. 定义 preview layout schema。
3. 新增 normalizer、merge、CSS 生成纯逻辑。
4. 补充纯逻辑单测。

验收：

1. schema 能拒绝未知字段。
2. merge 顺序正确。
3. CSS 生成不包含用户原始 CSS。

### M2：渲染层接入

1. `generatePreviewCardArtifacts` 支持 options。
2. `theme.js` 支持追加 override CSS。
3. `video` renderer 增加 `data-layout-key`。
4. Puppeteer 采集元素 metadata。
5. Preview Lab 的 `renderOverrides` 真正生效。

验收：

1. 无 override 时截图不变或仅 DOM attribute 变化。
2. 临时 override 能改变 PNG。
3. metadata 坐标准确。

### M3：Dashboard API

1. 新增 preview-layout API 模块。
2. 接入 config snapshot/save。
3. 实现 schema/config/preview/reset。
4. 补充 API 单测。

验收：

1. 未登录无法访问。
2. 合法配置可保存。
3. 非法配置被拒绝。
4. preview 返回 PNG 与元素 metadata。

### M4：WebUI 编辑器

1. 新增 `/preview-layout` 页面。
2. 接入导航。
3. 实现链接输入、结构示例、群组/模板选择。
4. 实现预览画布、元素 overlay、属性面板。
5. 实现保存、重置、错误提示。
6. 第一阶段只允许保存 `video`。

验收：

1. 能从真实链接生成预览。
2. 能选中元素并调整参数。
3. 保存后刷新页面仍保留配置。
4. 移动端不出现控件遮挡。
5. 预览失败时保留上一张有效图。

### M5：真实发图链路接入与回归

1. `imageGenerator.generatePreviewCard` 读取 effective layout。
2. 链接预览和订阅推送均应用配置。
3. 跑固定链接回归。
4. 补充使用说明。

验收：

1. 群消息链接解析生效。
2. 订阅推送生效。
3. 群组覆盖优先于全局配置。
4. 清空配置后恢复默认渲染。
5. dynamic/article 等未开放类型不受 video 配置影响。

## 文件清单

预计新增：

1. `docs/plans/2026-05-26-webui-preview-layout-editor-design.md`
2. `src/services/previewLayout/schema.js`
3. `src/services/previewLayout/normalizer.js`
4. `src/services/previewLayout/merge.js`
5. `src/services/previewLayout/css.js`
6. `src/services/previewLayout/elementMetadata.js`
7. `src/dashboard/routes/api/modules/preview-layout.js`
8. `dashboard/src/pages/PreviewLayoutEditor.jsx`
9. `dashboard/src/pages/preview-layout/**`
10. `test/unit/preview-layout/**`

预计修改：

1. `src/services/imageGenerator/generators/previewCard.js`
2. `src/services/imageGenerator/core/theme.js`
3. `src/services/imageGenerator/index.js`
4. `src/services/imageGenerator/renderers/video.js`
5. `src/services/imageGenerator/renderers/dynamic.js`
6. `src/services/imageGenerator/renderers/article.js`
7. `src/services/imageGenerator/renderers/live.js`
8. `src/services/imageGenerator/renderers/bangumi.js`
9. `src/services/imageGenerator/renderers/user.js`
10. `src/services/previewLab/session.js`
11. `src/services/previewLab/webServer.js`
12. `src/config/schema.js`
13. `src/config/index.js`
14. `src/dashboard/routes/api/index.js`
15. `dashboard/src/App.jsx`
16. `dashboard/src/components/navigation.js`

第一阶段实际应修改的 renderer 仅为 `video.js`。上面列出的其他 renderer 是第二阶段扩展候选文件，不应在 video 闭环未通过 review 前修改。

## 测试计划

### 自动测试

1. Preview layout schema/normalizer:
   - 合法配置通过。
   - 未知元素被拒绝。
   - 未知字段被拒绝。
   - 任意 CSS 字符串、selector、style 文本被拒绝。
   - 越界数值被拒绝。
   - 超过 `64KB` 的 API 请求被拒绝。
2. Merge:
   - 内置默认、global、group、temporary 合并顺序正确。
3. CSS:
   - 只生成白名单属性。
   - `visible=false` 输出隐藏规则。
4. Preview API:
   - 无输入返回 400。
   - 非法 override 返回 400。
   - 合法 preview 返回图片和 metadata。
5. Rendering:
   - 无 override 时 `generatePreviewCard` 正常。
   - 有 override 时 HTML 包含 override CSS。
   - 订阅推送分组 key 纳入 layout signature。
6. Frontend:
   - `npm --prefix dashboard run lint`
   - `npm --prefix dashboard run build`。
7. 根项目：
   - `npm test`
   - 仓库当前没有 `npm run validate`；如后续新增则再纳入。
8. Python：
   - 本功能不改 Python；最终验证可按 CI 执行 `python -m pytest test/unit/bilibili`，运行前遵守本仓库 Python venv 规则。

### 第一阶段重点测试文件

建议新增或扩展：

1. `test/unit/preview-layout/preview-layout-schema.test.js`
2. `test/unit/preview-layout/preview-layout-normalizer.test.js`
3. `test/unit/preview-layout/preview-layout-merge.test.js`
4. `test/unit/preview-layout/preview-layout-css.test.js`
5. `test/unit/dashboard/dashboard-preview-layout-api.test.js`
6. `test/unit/rendering/preview-layout-video-rendering.test.js`
7. `test/unit/preview/preview-lab-session.test.js`

其中 rendering 回归至少验证：

1. 无 override 时 `generatePreviewCardArtifacts` 可正常返回 base64/html/debugMeta。
2. 有 override 时 HTML 包含受控 override CSS。
3. HTML 中不包含用户传入的任意 CSS 原文。
4. `video` DOM 包含预期 `data-layout-key`。

### 人工回归链接

建议固定覆盖：

1. 视频：`https://www.bilibili.com/video/BV16nfwBXEdP`
2. 动态：`https://t.bilibili.com/1181751663738748928`
3. 专栏：`https://www.bilibili.com/read/cv17878862`
4. Opus：`https://www.bilibili.com/opus/1183668934980665366`
5. 直播：任选一个公开直播间。
6. 番剧：任选一个 `ss` 或 `ep` 链接。
7. 用户：任选一个 `space.bilibili.com/<uid>` 链接。

输出产物如需落盘，统一写入 `test/output/`。

## 风险评估

### P0 风险：真实发图布局异常

原因：

1. 用户配置过激。
2. CSS override 破坏流式布局。
3. 不同卡片类型 DOM 差异大。

控制：

1. 第一阶段只开放流式、安全参数。
2. 严格限制数值范围。
3. 支持一键重置。
4. 保存前用真实预览确认。

### P1 风险：编辑器预览与实际发图不一致

原因：

1. 前端模拟与后端截图不一致。

控制：

1. 前端只用后端返回 PNG 做底图。
2. 最终预览必须由同一 `generatePreviewCardArtifacts` 生成。

### P1 风险：Puppeteer 预览性能差

原因：

1. 高频编辑触发截图。

控制：

1. 前端 debounce。
2. 拖拽过程中只更新 overlay。
3. 结构示例模式优先调模板。

### P2 风险：配置演进困难

原因：

1. 配置 schema 后续扩展。

控制：

1. 顶层保留 `version`。
2. normalizer 支持旧版本迁移。
3. dashboard 保存/预览 API 对未知字段硬拒绝；只有真实发图读取已保存配置时，为避免生产发图中断，可以丢弃损坏字段、记录 warn 并回退默认 layout。

## 审批点

实施前需要明确批准以下代码/配置改动范围：

1. 允许新增 `previewLayoutConfig` 配置字段或等价独立配置文件。
2. 允许修改图片渲染器 DOM，补充 `data-layout-key`。
3. 允许调整 `generatePreviewCardArtifacts` 函数签名并保持兼容。
4. 允许新增 dashboard API 模块与 WebUI 页面。
5. 允许让保存后的布局配置影响真实 QQ 预览图发送。

## 推荐落地顺序

建议不要一次性完成所有模板。最稳路径：

1. 先做 `video` 类型闭环：
   - schema
   - API
   - renderer key
   - WebUI 编辑
   - 实际发图生效
2. 再扩展 `dynamic` 与 `article`。
3. 最后覆盖 `live`、`bangumi`、`user`。

这样能快速验证“受控 layout override”路线是否稳定，避免一次性碰到所有卡片类型导致风险扩大。

## 文档 Review 检查清单

独立 reviewer 必须按以下清单给出结论：

1. 是否明确复用后端真实 `imageGenerator + Puppeteer`，没有前端近似模拟替代最终结果。
2. 是否明确无配置时真实发图保持不变。
3. 是否明确 `previewLayoutConfig` 只保存用户修改字段，默认配置不落盘。
4. 是否明确 `global -> group -> temporary` 合并顺序。
5. 是否明确拒绝未知元素、未知字段、任意 CSS、越界数值和超大 JSON。
6. 是否明确 dashboard API 走现有鉴权。
7. 是否明确 preview API 默认不写临时文件到非必要位置。
8. 是否覆盖真实链接预览、结构示例、群组覆盖、重置能力。
9. 是否明确保存配置同时影响链接解析发图和订阅推送。
10. 是否给出 schema/merge/css/API/render/dashboard build 测试计划。

如 reviewer 发现 P0/P1 问题，必须先修本文档，再进入实现阶段。
