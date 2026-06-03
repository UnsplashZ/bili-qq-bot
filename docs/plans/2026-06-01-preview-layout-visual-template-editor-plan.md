# B 站链接解析可视化模板编辑器完整落地方案

## 摘要

目标是把当前 WebUI `/preview-layout` 从“预览图布局微调器”升级为“B 站链接解析卡片模板编辑器”。

用户希望各种元素、容器、tag 都能在 WebUI 中直接组合、拖动、缩放和调整，最终生成用户想要的 B 站链接解析推送图片效果。

本方案推荐继续保留现有图片生成真源：

1. B 站数据解析仍走现有链接解析链路。
2. 图片生成仍走后端 HTML/CSS renderer + Puppeteer 截图。
3. WebUI 编辑器不直接成为最终渲染真源，而是编辑一份结构化模板 DSL。
4. WebUI 预览和实际 QQ 推送都读取同一份模板 DSL，再由后端 HTML/CSS renderer 出图。
5. 拖动、缩放、吸附、排序等交互使用成熟前端库，不手搓核心交互。

推荐技术组合：

| 能力 | 推荐方案 | 说明 |
| --- | --- | --- |
| 自由拖动、缩放、吸附、成组 | `react-moveable` | 负责画布上元素的移动、尺寸调整、吸附线和多选基础能力 |
| 容器内排序、跨容器移动 | `dnd-kit` | 负责 stack/flex/grid 容器内元素顺序调整 |
| 模板结构与渲染协议 | 自定义模板 DSL | 保证编辑器和实际推送共享同一份配置 |
| 最终出图 | 现有 HTML/CSS + Puppeteer | 继续复用当前 renderer、主题、截图和测试体系 |

不建议直接用 Polotno、tldraw、Konva、Fabric 这类 Canvas 设计器替代主链路。它们适合完整 Canvas 场景，但本项目的真实出图已经是 HTML/CSS 截图。如果 WebUI 使用 Canvas scene，最终出图仍使用 HTML/CSS，就会引入两套渲染真源，文字换行、字体、图片裁切、emoji、行高、阴影和容器自适应容易不一致。

## 背景与当前真源

当前项目已经具备以下基础：

1. WebUI 路由：
   - `dashboard/src/pages/PreviewLayoutEditor.jsx`
   - `/preview-layout`
2. Dashboard API：
   - `src/dashboard/routes/api/modules/preview-layout.js`
   - `GET /api/preview-layout/schema`
   - `GET /api/preview-layout/config`
   - `POST /api/preview-layout/config`
   - `POST /api/preview-layout/reset`
   - `POST /api/preview-layout/preview`
3. 预览布局核心：
   - `src/services/previewLayout/schema.js`
   - `src/services/previewLayout/merge.js`
   - `src/services/previewLayout/css.js`
   - `src/services/previewLayout/elementMetadata.js`
4. 图片生成真源：
   - `src/services/imageGenerator/generators/previewCard.js`
   - `src/services/imageGenerator/renderers/**`
   - 当前通过 renderer 输出 HTML，再由 Puppeteer 对 `.container` 截图。
5. 配置存储：
   - 当前已有 `previewLayoutConfig`。
   - 全局和群组覆盖已经存在初步模型。
6. 当前已解决的基础问题：
   - B 站主卡片类型已经扩展到 `video/dynamic/article/live/bangumi/user` 的主元素级编辑。
   - `data-layout-key` 已作为 renderer 与编辑器之间的稳定元素定位协议。
   - 可见性草稿、保存和预览状态同步已有第一版基础。

新方案应建立在这些能力之上，不重写链接解析、不重写消息发送、不重写截图引擎。

## 目标

### 产品目标

1. 用户可以在 WebUI 中可视化编辑 B 站链接解析卡片模板。
2. 用户可以拖动、缩放和调整元素位置。
3. 用户可以组合容器、文本、图片、tag、统计栏等模块。
4. 用户可以选择自由布局或容器布局。
5. 用户可以保存为全局模板或群组覆盖模板。
6. 用户保存后的配置必须影响真实 QQ 推送图片。
7. WebUI 预览结果必须和真实推送结果使用同一渲染链路。
8. 配置异常时必须可回退，不应影响链接解析发图。

### 技术目标

1. 定义一套可版本化、可迁移、可校验的模板 DSL。
2. 将现有 `previewLayoutConfig` 从“元素 CSS patch”升级为“模板树 + 样式 + 数据绑定”。
3. 继续支持旧配置读取和迁移。
4. 引入 `react-moveable` 处理自由拖拽、缩放、吸附和多选交互。
5. 引入 `dnd-kit` 处理容器内部排序与跨容器移动。
6. 后端 renderer 消费同一份 DSL 生成 HTML/CSS。
7. 自动测试覆盖 DSL 校验、迁移、渲染、API、编辑器关键状态。

## 非目标

1. 不把推送图片主链路改成 Canvas 渲染。
2. 不允许用户输入任意 CSS 或任意 HTML。
3. 不开放执行用户自定义 JS。
4. 不在第一阶段做完整 Canva/Figma 级设计器。
5. 不在第一阶段支持用户上传任意图片素材库。
6. 不在第一阶段支持跨设备实时协作。
7. 不在第一阶段支持模板市场。
8. 不影响无配置时的默认卡片样式。

## 核心设计原则

1. **单一渲染真源**
   - 最终出图只认后端 HTML/CSS renderer。
   - WebUI 只是编辑和预览同一份 DSL。

2. **交互库只负责交互，不负责业务结构**
   - `react-moveable` 不直接决定模板数据结构。
   - `dnd-kit` 不直接决定 renderer 结构。
   - 模板 DSL 是项目自己的稳定协议。

3. **自由布局和容器布局并存**
   - tag、徽章、封面、装饰块适合自由布局。
   - 作者栏、统计栏、标题区、简介区适合 stack/flex 容器布局。

4. **默认不做强自动避让**
   - 自由画布中元素允许重叠，但给出重叠提示。
   - 容器布局中元素按容器规则自动重排。
   - 后续可提供“一键整理”或“自动避让”命令。

5. **旧能力可迁移**
   - 现有 `elements[key].layout/style/visible` 不能废弃。
   - 需要提供迁移器转换成 v2 模板节点。

## 推荐库调研结论

### react-moveable

参考：

- https://github.com/daybrush/moveable
- https://daybrush.com/moveable/release/latest/doc/Moveable.html

适合能力：

1. Draggable
2. Resizable
3. Scalable
4. Rotatable
5. Snappable
6. Groupable
7. 多方向控制点

使用范围：

1. 画布上选中节点后的拖动和缩放。
2. 多选后整体移动。
3. 元素边缘、中心线、画布边界吸附。
4. 生成 transform / x / y / width / height 修改，再写回 DSL。

不让它承担：

1. 模板树结构。
2. 数据绑定。
3. 最终渲染。

### dnd-kit

参考：

- https://docs.dndkit.com/presets/sortable
- https://docs.dndkit.com/guides/accessibility

适合能力：

1. 容器内部排序。
2. 多容器拖放。
3. 键盘可访问性基础。
4. 自定义 collision detection。

使用范围：

1. stack/flex 容器内节点排序。
2. 左侧元素树拖动调整层级。
3. 从组件面板拖入容器。

不让它承担：

1. 自由画布上像素级拖动。
2. 缩放控制点。

### Puck

参考：

- https://puckeditor.com/docs/integrating-puck/component-configuration
- https://puckeditor.com/docs/api-reference/configuration/component-config

判断：

Puck 的“Config 定义组件、fields 定义属性、编辑器生成 data payload、Render 消费 payload”的架构值得借鉴，但不建议直接把 Puck 作为主编辑器。

原因：

1. Puck 偏页面 builder / block builder。
2. 本项目是固定图片卡片模板，最终通过后端 HTML/CSS 截图。
3. 当前已有 renderer、API、配置、测试，不适合把主链路托管给 Puck。

可借鉴：

1. 组件注册表。
2. 字段 schema。
3. payload 与 renderer 分离。
4. defaultProps 写入新节点。

### 不推荐作为主方案的库

| 库 | 不推荐作为主方案的原因 |
| --- | --- |
| GrapesJS | 偏网页搭建器，HTML/CSS 编辑能力过重，接入后需要约束大量非目标能力 |
| Polotno | Canvas 设计器能力完整，但会引入 Canvas scene 与 HTML renderer 双真源问题 |
| tldraw | 更偏白板 / infinite canvas，适合自定义 shape，但不贴当前截图出图链路 |
| Konva / Fabric | 底层 Canvas 能力强，但完整编辑器交互仍要大量自研 |
| react-grid-layout | 更适合仪表盘网格，不适合卡片级自由布局和细粒度视觉编辑 |

## 总体架构

```text
WebUI Visual Template Editor
  |
  | edits template DSL
  v
Preview Template Draft
  |
  | POST /api/preview-layout/preview
  v
Dashboard API
  |
  | validate + merge global/group/draft template
  v
Preview Target Resolver
  |
  | Bilibili data or mock data
  v
Template Renderer
  |
  | template DSL + data binding -> HTML/CSS
  v
Puppeteer Screenshot
  |
  v
Preview PNG + node metadata

Saved Global/Group Template
  |
  v
Real Link Push
  |
  v
Same Template Renderer -> Puppeteer Screenshot -> QQ Image
```

## 模板 DSL 设计

### 配置根结构

继续使用 `previewLayoutConfig` 作为配置入口，升级版本为 `2`。

```json
{
  "version": 2,
  "global": {
    "video": {
      "template": {
        "canvas": {},
        "nodes": []
      }
    }
  },
  "groups": {
    "123456789": {
      "video": {
        "template": {
          "canvas": {},
          "nodes": []
        }
      }
    }
  }
}
```

兼容要求：

1. 读取 `version: 1` 或无版本配置时，走 v1 -> v2 迁移器。
2. 保存时默认写 `version: 2`。
3. 如果迁移失败，记录 warn 并回退内置默认模板，不中断发图。

### Template

```json
{
  "canvas": {
    "width": 1000,
    "height": "auto",
    "minHeight": 320,
    "maxHeight": 1600,
    "padding": 24,
    "background": {
      "type": "gradient",
      "colors": ["#D8C7F1", "#BFE6E2"]
    }
  },
  "nodes": []
}
```

说明：

1. `width` 建议保持当前截图宽度体系。
2. `height: auto` 表示由内容和布局计算。
3. 第一阶段不开放用户修改画布物理宽度，只作为 DSL 字段保留。
4. 氛围色配置可逐步并入 `canvas.background`，但需要兼容现有氛围色设置。

### Node

```json
{
  "id": "title",
  "type": "element",
  "role": "title",
  "label": "标题",
  "parentId": "content",
  "visible": true,
  "locked": false,
  "layout": {},
  "style": {},
  "binding": {},
  "children": []
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `id` | 模板内稳定 ID，用户新增节点使用 `node_xxx` |
| `type` | `container` / `element` / `tag` / `text` / `image` / `stats` / `shape` |
| `role` | 业务角色，如 `title`、`cover`、`avatar`、`typeBadge` |
| `label` | WebUI 展示名 |
| `parentId` | 父容器 ID，根节点挂在 `root` |
| `visible` | 是否显示 |
| `locked` | 是否锁定，不允许拖动和编辑 |
| `layout` | 布局规则 |
| `style` | 视觉样式 |
| `binding` | 数据绑定 |
| `children` | 可选，推荐运行时归一化成 flat tree |

### Node Type

#### container

用于组织布局。

```json
{
  "id": "header",
  "type": "container",
  "role": "header",
  "layout": {
    "mode": "flex",
    "direction": "row",
    "gap": 12,
    "align": "center",
    "justify": "start"
  }
}
```

支持模式：

1. `absolute`
2. `stack`
3. `flex`
4. `grid`

#### element

绑定已有 B 站解析数据的业务元素。

示例：

```json
{
  "id": "title",
  "type": "element",
  "role": "title",
  "binding": {
    "source": "video.title"
  },
  "layout": {
    "mode": "flow",
    "width": "100%"
  },
  "style": {
    "fontSize": 30,
    "lineHeight": 1.25,
    "maxLines": 2
  }
}
```

#### tag

用于类型标签、状态标签、自定义徽章。

```json
{
  "id": "typeBadge",
  "type": "tag",
  "role": "typeBadge",
  "binding": {
    "source": "card.typeLabel",
    "fallback": "视频"
  },
  "layout": {
    "mode": "absolute",
    "x": 24,
    "y": 24,
    "width": "auto",
    "height": 44,
    "zIndex": 20
  },
  "style": {
    "background": "#F85B8F",
    "color": "#FFFFFF",
    "radius": 14
  }
}
```

#### text

用户新增的静态或绑定文本。

```json
{
  "id": "customText_1",
  "type": "text",
  "label": "自定义文本",
  "binding": {
    "source": "static",
    "value": "来自 B 站"
  }
}
```

#### image

第一阶段只用于已有数据图片，例如封面、头像、动态图片。后续再考虑用户上传图片。

```json
{
  "id": "cover",
  "type": "image",
  "role": "cover",
  "binding": {
    "source": "video.cover"
  },
  "style": {
    "objectFit": "cover",
    "objectPosition": "50% 50%",
    "radius": 16
  }
}
```

#### stats

统计栏容器。

```json
{
  "id": "stats",
  "type": "stats",
  "role": "stats",
  "items": ["views", "likes", "comments"],
  "layout": {
    "mode": "flex",
    "direction": "row",
    "gap": 12
  }
}
```

### Layout

#### absolute

用于自由拖动定位。

```json
{
  "mode": "absolute",
  "x": 24,
  "y": 24,
  "width": 220,
  "height": 64,
  "zIndex": 10,
  "anchor": "topLeft"
}
```

#### stack

用于垂直流式排列。

```json
{
  "mode": "stack",
  "gap": 8,
  "padding": 16
}
```

#### flex

用于作者栏、统计栏。

```json
{
  "mode": "flex",
  "direction": "row",
  "gap": 10,
  "align": "center",
  "justify": "space-between"
}
```

#### grid

用于动态多图。

```json
{
  "mode": "grid",
  "columns": 3,
  "gap": 8,
  "aspectRatio": "1/1"
}
```

### Style

第一阶段只开放白名单字段。

```json
{
  "fontSize": 28,
  "fontWeight": 700,
  "lineHeight": 1.25,
  "maxLines": 2,
  "color": "#1F2937",
  "background": "#FFFFFF",
  "radius": 16,
  "opacity": 1,
  "shadow": "soft",
  "objectFit": "cover",
  "objectPosition": "50% 50%"
}
```

禁止：

1. 任意 CSS 字符串。
2. `position: fixed`。
3. `url(...)` 形式的用户输入背景。
4. `content`、`behavior`、`animation` 这类容易扩大安全边界的字段。

### Binding

绑定 B 站解析数据。

```json
{
  "source": "video.title",
  "fallback": "视频标题",
  "format": "plainText"
}
```

建议绑定源：

| 类型 | 绑定源示例 |
| --- | --- |
| 通用 | `card.typeLabel`, `card.url`, `card.type` |
| video | `video.title`, `video.cover`, `video.author.name`, `video.stats.views` |
| dynamic | `dynamic.text`, `dynamic.author.name`, `dynamic.media[]` |
| article | `article.title`, `article.cover`, `article.summary` |
| live | `live.title`, `live.cover`, `live.roomId`, `live.status` |
| bangumi | `bangumi.title`, `bangumi.cover`, `bangumi.progress` |
| user | `user.name`, `user.avatar`, `user.signature`, `user.stats.followers` |

绑定层只允许从后端归一化后的 safe data 读取，不允许在模板中写 JS 表达式。

## 默认模板设计

### 内置默认模板

每个主类型都需要一份内置默认模板：

1. `video`
2. `dynamic`
3. `article`
4. `live`
5. `bangumi`
6. `user`

默认模板来源：

1. 以当前 renderer 输出为视觉基线。
2. 通过模板节点表达当前结构。
3. 未保存用户配置时，渲染结果必须与当前版本尽量一致。

### 旧配置迁移

现有 v1 结构大致是：

```json
{
  "version": 1,
  "global": {
    "video": {
      "elements": {
        "title": {
          "visible": false,
          "layout": {},
          "typography": {}
        }
      }
    }
  }
}
```

迁移规则：

1. 先加载对应类型的内置默认 v2 模板。
2. 对每个 `elements[key]` 找到同 ID 节点。
3. `visible` 写入节点 `visible`。
4. `layout.offsetX/offsetY/width/height` 映射到节点 layout。
5. `typography.fontSize/lineHeight/maxLines` 映射到节点 style。
6. `media.aspectRatio/objectFit/objectPosition` 映射到图片节点 style。
7. 无法映射的字段记录 warn，不阻断迁移。

## WebUI 设计

### 页面结构

```text
预览编辑器
  来源与模板选择
  模板操作栏
  主编辑区
    左侧：节点树 / 组件库 / 图层
    中间：画布
    右侧：属性面板
```

### 来源与模板选择

保留现有能力：

1. 结构示例 / 真实链接。
2. B 站链接输入。
3. 群组选择。
4. 模板类型选择。

调整：

1. 来源和操作栏可合并在一个上方工作区。
2. 当前模板状态显示为“草稿未保存 / 已保存 / 预览待更新”。

### 左侧面板

分为三个 tab：

1. **节点**
   - 展示当前模板树。
   - 支持选择节点。
   - 支持拖动调整层级。
   - 支持显示 / 隐藏。
   - 支持锁定 / 解锁。

2. **组件**
   - 容器
   - 文本
   - tag
   - 图片占位
   - 统计栏
   - 分隔线 / shape

3. **图层**
   - 按 zIndex 展示 absolute 节点。
   - 支持上移、下移、置顶、置底。

### 中间画布

能力：

1. 显示真实渲染预览图。
2. 覆盖可交互 overlay。
3. 点击元素选中。
4. 拖动元素改变位置。
5. 缩放元素改变尺寸。
6. 显示吸附线。
7. 显示画布边界、安全区和中心线。
8. 显示“预览更新中”状态。
9. 支持缩放画布视图，不改变真实输出尺寸。

交互策略：

1. 拖动中只更新 overlay，不立即触发 Puppeteer。
2. 拖动结束后写入 draft DSL。
3. 拖动结束后延迟触发真实预览。
4. 快速连续操作时合并预览请求。
5. 旧请求不得覆盖新请求结果。

### 右侧属性面板

按节点类型动态显示字段。

通用字段：

1. 显示 / 隐藏。
2. 锁定。
3. 名称。
4. 层级。

布局字段：

1. X / Y。
2. 宽 / 高。
3. 布局模式。
4. margin / padding / gap。
5. 对齐方式。

文字字段：

1. 字号。
2. 字重。
3. 行高。
4. 最大行数。
5. 颜色。

图片字段：

1. 比例。
2. 裁切方式。
3. 焦点位置。
4. 圆角。

tag 字段：

1. 图标。
2. 文案来源。
3. 背景色。
4. 圆角。
5. 内边距。

容器字段：

1. 布局模式。
2. 方向。
3. gap。
4. align。
5. justify。
6. 自动高度。

### 操作栏

建议按钮：

1. 应用预览。
2. 保存到全局。
3. 保存到当前群。
4. 重载已保存配置。
5. 重置选中节点。
6. 重置当前模板。
7. 导出模板 JSON。
8. 导入模板 JSON。

第一阶段可只实现 1-6，导入导出后置。

## 后端设计

### 模块划分

新增或扩展：

```text
src/services/previewTemplate/
  schema.js
  defaults.js
  normalizer.js
  migrator.js
  merge.js
  renderer.js
  css.js
  bindings.js
  metadata.js
```

也可以先复用 `src/services/previewLayout/`，但建议在进入完整模板 DSL 阶段时拆出 `previewTemplate`，避免旧 layout patch 概念继续污染新模型。

### schema.js

职责：

1. 定义 node type。
2. 定义可编辑字段。
3. 定义每种卡片类型的可用业务 role。
4. 定义字段范围和默认值。

### defaults.js

职责：

1. 返回每种卡片类型的内置默认模板。
2. 默认模板必须能独立渲染。
3. 默认模板应作为无配置回退来源。

### normalizer.js

职责：

1. 清理未知字段。
2. 限制数值范围。
3. 生成缺失 ID。
4. 校验 parentId。
5. 校验不允许循环引用。
6. 过滤危险 style。

### migrator.js

职责：

1. v1 `previewLayoutConfig` 迁移到 v2。
2. 未来版本迁移。
3. 迁移失败可局部丢弃异常节点。

### merge.js

职责：

1. 合并内置默认模板。
2. 合并全局模板。
3. 合并群组覆盖。
4. 合并临时 draft。

合并顺序：

```text
builtInDefault(type)
  -> global[type]
  -> groups[groupId][type]
  -> draft override
```

### bindings.js

职责：

1. 将 B 站解析数据归一化成 safe view model。
2. 模板只读取 view model。
3. 处理 fallback。
4. 处理格式化，例如数字、人类可读统计、时间。

### renderer.js

职责：

1. 将 DSL 节点树渲染为 HTML。
2. 生成节点 class 和 `data-template-node-id`。
3. 兼容现有 `data-layout-key`。
4. 保证用户输入文本 escape。
5. 不执行模板内表达式。

建议新增稳定属性：

```html
<div data-template-node-id="title" data-layout-key="title"></div>
```

`data-layout-key` 用于兼容现有编辑器和测试，`data-template-node-id` 用于 v2 节点级精确定位。

### css.js

职责：

1. 将 DSL layout/style 转为受控 CSS。
2. 只输出白名单属性。
3. 对 absolute 节点输出 `left/top/width/height/z-index`。
4. 对 stack/flex/grid 容器输出对应 layout CSS。
5. 对图片节点输出 object-fit / object-position。

### metadata.js

职责：

1. Puppeteer 截图后采集每个节点 bounding box。
2. 返回节点真实位置、大小、可见性、computed defaults。
3. 支持 WebUI overlay 对齐。

## API 设计

可以沿用 `/api/preview-layout` 路径，逐步增加 v2 字段。

### GET /api/preview-layout/schema

返回：

```json
{
  "version": 2,
  "types": {},
  "nodeTypes": {},
  "roles": {},
  "controls": {}
}
```

### GET /api/preview-layout/config

请求参数：

1. `type`
2. `groupId`

返回：

```json
{
  "type": "video",
  "groupId": null,
  "template": {},
  "source": {
    "global": {},
    "group": {}
  }
}
```

### POST /api/preview-layout/config

保存全局或群组模板。

请求：

```json
{
  "type": "video",
  "scope": "global",
  "groupId": null,
  "template": {}
}
```

行为：

1. normalize。
2. validate。
3. 保存最小差异或完整模板快照。
4. 返回 effective template。

### POST /api/preview-layout/preview

请求：

```json
{
  "source": "mock",
  "mockType": "video",
  "url": "",
  "groupId": null,
  "type": "video",
  "draftTemplate": {}
}
```

返回：

```json
{
  "image": "data:image/png;base64,...",
  "template": {},
  "nodes": {
    "title": {
      "visible": true,
      "bounds": {}
    }
  }
}
```

### POST /api/preview-layout/reset

支持：

1. 重置选中节点。
2. 重置当前模板。
3. 重置当前群覆盖。
4. 重置全部全局模板。

### POST /api/preview-layout/template/validate

后续增加，用于导入模板前校验。

## 渲染链路改造

### 当前链路

```text
renderer(type, data)
  -> HTML string
  -> override CSS by data-layout-key
  -> Puppeteer screenshot
```

### 目标链路

```text
viewModel = normalizeBilibiliData(type, data)
template = getEffectiveTemplate(type, groupId, draft)
html = renderTemplateToHtml(template, viewModel)
css = renderTemplateCss(template)
screenshot(html + css)
```

### 兼容策略

第一阶段不立即删除原 renderer。

建议分层：

1. `legacyRenderer`
   - 当前 renderer。
   - 继续提供默认视觉基线。

2. `templateRenderer`
   - 新 DSL renderer。
   - 首先覆盖 `video`。
   - 稳定后覆盖其他类型。

3. `rendererAdapter`
   - 根据模板版本和功能开关选择 renderer。

切换条件：

1. 无 v2 模板时可继续走 legacy renderer。
2. v2 模板启用后走 template renderer。
3. 如果 template renderer 报错，记录 error 并回退 legacy renderer。

## 编辑交互实现细节

### 坐标系

必须区分三个坐标：

1. 输出坐标：真实图片坐标，例如 1000px 宽。
2. 画布显示坐标：WebUI 缩放后的显示尺寸。
3. 屏幕坐标：鼠标事件坐标。

规则：

```text
outputX = displayX / zoomScale
outputY = displayY / zoomScale
```

所有保存到 DSL 的坐标都必须是输出坐标，不保存浏览器显示坐标。

### 拖动

流程：

1. 用户选中 absolute 节点。
2. `react-moveable` 接管 overlay target。
3. 拖动中更新 overlay transform。
4. 拖动结束计算输出坐标。
5. 写入 draft template。
6. 标记 preview outdated。
7. debounce 后请求真实预览。

### 缩放

流程：

1. 用户拖动控制点。
2. 保持最小宽高限制。
3. 图片节点可按比例锁定。
4. 写入 `width/height`。
5. 对文本节点缩放默认只改容器尺寸，不直接拉伸字体。

### 容器排序

流程：

1. 用户在节点树或容器内部拖动。
2. `dnd-kit` 更新 children 顺序。
3. 对 stack/flex/grid 容器触发自动重排。
4. 请求真实预览。

### 吸附

第一阶段吸附目标：

1. 画布左/中/右。
2. 画布上/中/下。
3. 安全区边缘。
4. 其他节点边缘。
5. 其他节点中心线。

### 多选

第一阶段可以后置。若做，范围为：

1. Shift 点击多选。
2. 多选整体移动。
3. 暂不做多选缩放。
4. 暂不做成组。

### 撤销重做

建议从第一阶段就设计数据结构，但可第二阶段落地。

实现：

1. draft template 变更进入 history stack。
2. 每次拖动中不入栈，拖动结束入栈。
3. 保存成功不清空 history，但标记 saved snapshot。

## 分阶段实施计划

### Phase 0：技术 Spike

目标：验证 `react-moveable` 能在当前预览图 overlay 上稳定工作。

范围：

1. 安装并接入 `react-moveable`。
2. 只针对 `video.title` 或 `video.cover` 做本地实验。
3. 验证缩放比例、坐标转换、overlay 与真实截图对齐。
4. 不保存配置。

验收：

1. 桌面宽度拖动不漂移。
2. 移动端宽度 overlay 不错位。
3. 缩放画布后坐标仍正确。

### Phase 1：现有元素拖动和缩放闭环

目标：让当前已有主元素支持拖动、缩放、保存和真实推送生效。

范围：

1. 扩展现有 `previewLayoutConfig` v1 或引入 v2 最小结构。
2. 在画布 overlay 上接入 `react-moveable`。
3. 支持 absolute override：
   - x
   - y
   - width
   - height
   - zIndex
4. 支持锁定比例。
5. 拖动结束刷新真实预览。
6. 保存到全局 / 当前群后真实发图生效。

暂不做：

1. 新增节点。
2. 容器内部排序。
3. 任意组合。

验收：

1. `typeBadge` 隐藏后真实预览不显示标签。
2. `title` 拖动后真实预览位置变化。
3. `cover` 缩放后真实预览尺寸变化。
4. 保存全局后普通链接解析使用新布局。

### Phase 2：模板 DSL v2 和默认模板

目标：建立完整 DSL 和迁移机制。

范围：

1. 新增 `src/services/previewTemplate/**`。
2. 定义 v2 schema。
3. 定义 `video` 默认模板。
4. 实现 v1 -> v2 迁移。
5. WebUI 使用 v2 draft。
6. 后端 renderer 能消费 v2。

验收：

1. 无配置时输出与旧默认样式一致或差异可接受。
2. 旧 v1 配置能迁移并保持可见性、尺寸、位置设置。
3. 异常配置不会中断发图。

### Phase 3：容器布局和 dnd-kit 排序

目标：支持元素、容器、tag 的结构化组合。

范围：

1. 支持容器节点：
   - stack
   - flex
   - grid
2. 支持节点树。
3. 支持节点拖入容器。
4. 支持容器内排序。
5. 支持作者栏和统计栏结构化编辑。

验收：

1. 作者栏内头像、名称、发布时间可排序。
2. 统计栏内播放、点赞、评论可排序和隐藏。
3. 容器移动时子节点一起移动。
4. 容器布局不会出现明显重叠。

### Phase 4：新增元素和 tag

目标：用户可以组合更多元素。

范围：

1. 组件面板支持新增：
   - tag
   - 静态文本
   - 分隔线
   - shape
   - 数据文本
2. tag 支持图标、文案、颜色。
3. 文本支持静态文本和绑定文本。
4. 支持复制、删除节点。

验收：

1. 用户可以新增一个“UP 主推荐”tag。
2. 用户可以新增一段静态说明文字。
3. 新增节点保存后真实推送生效。
4. 删除节点后不会残留样式。

### Phase 5：多类型模板迁移

目标：把 `dynamic/article/live/bangumi/user` 全部迁移到 v2 template renderer。

顺序建议：

1. `video`
2. `live`
3. `bangumi`
4. `article`
5. `dynamic`
6. `user`

原因：

1. `live/bangumi` 结构相对简单。
2. `article` 中等复杂。
3. `dynamic/user` 包含动态媒体和嵌套资源，风险最高。

验收：

1. 每种类型都有内置默认模板。
2. 每种类型都能新增 tag。
3. 每种类型都能隐藏主元素。
4. 每种类型真实链接和结构示例都通过 smoke。

### Phase 6：设计器增强

目标：接近完整编辑器体验。

范围：

1. 多选。
2. 成组。
3. 对齐分布。
4. 撤销重做。
5. 导入导出。
6. 模板复制。
7. 一键整理布局。
8. 重叠检测。

## 测试计划

### 单元测试

新增：

```text
test/unit/preview-template/preview-template-schema.test.js
test/unit/preview-template/preview-template-normalizer.test.js
test/unit/preview-template/preview-template-migrator.test.js
test/unit/preview-template/preview-template-merge.test.js
test/unit/preview-template/preview-template-renderer.test.js
test/unit/preview-template/preview-template-bindings.test.js
```

覆盖：

1. node schema 校验。
2. 禁止危险字段。
3. parentId 循环检测。
4. v1 -> v2 迁移。
5. global/group/draft 合并。
6. 绑定 fallback。
7. HTML escape。

### API 测试

扩展：

```text
test/unit/dashboard/dashboard-preview-layout-api.test.js
```

覆盖：

1. schema 返回 v2 字段。
2. config 返回 migrated template。
3. 保存非法节点返回 400。
4. preview 使用 draftTemplate。
5. reset 支持 node/template scope。
6. group override 合并正确。

### 渲染测试

新增或扩展：

```text
test/unit/rendering/preview-template-rendering.test.js
```

覆盖：

1. 默认模板渲染不抛错。
2. 节点包含 `data-template-node-id`。
3. 隐藏节点不输出或 display none。
4. absolute 节点输出正确 CSS。
5. 图片 object-fit 生效。

### 前端测试

如当前测试栈支持，可增加组件级测试。若不支持，先用 browser smoke 覆盖。

重点验证：

1. 快速拖动不会造成状态错乱。
2. 快速开关不会显示旧预览。
3. 保存后 draft 与 saved 状态正确。
4. 节点树状态和属性面板一致。

### 浏览器 smoke

使用本机浏览器验证：

1. `/preview-layout` 打开无报错。
2. 结构示例 video 生成预览。
3. 拖动标题并应用预览。
4. 缩放封面并应用预览。
5. 保存到全局。
6. 重新加载页面后配置仍存在。
7. 普通链接解析真实发图使用保存配置。
8. 窄屏下工具栏和属性面板不溢出。

### 验证命令

Node 相关最小验证：

```bash
./node_modules/.bin/mocha --exit test/unit/preview-layout/preview-layout-core.test.js test/unit/dashboard/dashboard-preview-layout-api.test.js
npm --prefix dashboard run lint
npm --prefix dashboard run build
```

完整验证视改动范围执行：

```bash
npm test
```

本地预览产物必须写入：

```text
test/output/
```

## 发布与回滚

### 功能开关

建议增加功能开关：

```json
{
  "previewTemplateEditor": {
    "enabled": true,
    "templateRendererV2": false
  }
}
```

也可以先作为内部常量，不暴露到系统设置。

用途：

1. WebUI 可先启用编辑器。
2. 真实推送可延迟启用 v2 renderer。
3. 出问题时回退 legacy renderer。

### 回滚策略

1. `templateRendererV2=false` 时真实发图回退 legacy renderer。
2. v2 配置不删除。
3. v1 配置迁移只读执行，不覆盖原始备份。
4. 保存前可写 `lastKnownGoodTemplate`。

## 安全与可靠性

1. 所有模板输入必须后端校验。
2. 所有文本必须 escape。
3. 不允许用户输入 HTML。
4. 不允许用户输入 JS。
5. 不允许任意 CSS 字符串。
6. 图片 URL 只能来自 B 站解析数据或后续受控素材源。
7. 配置损坏不能影响发图主流程。
8. Puppeteer 渲染失败应回退默认模板或 legacy renderer。
9. API 必须走现有 dashboard 鉴权。

## 主要风险

### 风险 1：编辑器预览和真实推送不一致

控制：

1. WebUI preview 和真实推送都调用同一 template renderer。
2. 不做前端近似渲染作为最终判断。
3. 拖动中可以用 overlay 临时反馈，松手后必须以真实截图为准。

### 风险 2：DSL 过早设计过重

控制：

1. Phase 1 只做现有元素拖动缩放。
2. Phase 2 再引入 v2 DSL。
3. 每阶段都保持可发版。

### 风险 3：动态和用户卡片结构复杂

控制：

1. 多类型迁移按简单到复杂推进。
2. dynamic/user 只先开放主元素。
3. 嵌套资源卡后续单独设计。

### 风险 4：交互库接入后状态复杂

控制：

1. Moveable 只写 draft，不直接保存。
2. 拖动中不请求 Puppeteer。
3. 松手后 debounce 请求。
4. 请求带 payload key，旧响应不能覆盖新画布。

### 风险 5：配置迁移破坏旧用户配置

控制：

1. 迁移器只读旧配置。
2. 保存 v2 前保留旧结构备份。
3. 提供 reset。
4. 测试覆盖典型 v1 配置。

## 复杂度评估

| 阶段 | 复杂度 | 主要难点 |
| --- | --- | --- |
| Phase 0 Spike | 低到中 | 坐标换算、overlay 对齐 |
| Phase 1 现有元素拖动缩放 | 中 | Moveable 接入、状态防抖、真实预览同步 |
| Phase 2 DSL v2 | 中高 | schema、迁移、renderer 分层 |
| Phase 3 容器布局 | 高 | 树结构、dnd-kit、多布局模式 |
| Phase 4 新增元素/tag | 高 | 组件注册、绑定、删除/复制、属性面板动态化 |
| Phase 5 多类型迁移 | 高 | 各 renderer 差异、动态/用户复杂结构 |
| Phase 6 设计器增强 | 很高 | 多选、成组、撤销重做、对齐分布 |

总体判断：

1. 如果只做“拖动和缩放现有元素”，复杂度可控。
2. 如果做到“任意组合元素、容器、tag”，这是一个完整编辑器项目，需要分阶段。
3. 推荐先做 Phase 0 + Phase 1，验证方向后再进入 DSL v2 大改。

## 建议开发顺序

1. **方案审核**
   - 确认不采用 Canvas 主渲染。
   - 确认使用 `react-moveable + dnd-kit + 自定义 DSL`。
   - 确认第一阶段只做现有元素拖动缩放。

2. **技术 Spike**
   - 接入 `react-moveable`。
   - 只验证一个元素拖动缩放。
   - 输出截图和坐标验证记录。

3. **Phase 1 开发**
   - 完成现有元素拖动、缩放、保存、真实推送闭环。

4. **Phase 1 Review**
   - 独立检查坐标、状态、保存和渲染一致性。

5. **Phase 2 设计冻结**
   - 基于 Phase 1 经验修订 DSL。
   - 再进入 v2 模板树实现。

6. **分类型迁移**
   - video -> live -> bangumi -> article -> dynamic -> user。

## 验收标准

### 第一阶段验收

1. 用户可以在 WebUI 选中现有元素。
2. 用户可以拖动元素位置。
3. 用户可以缩放元素尺寸。
4. 松手后真实预览图更新。
5. 保存到全局后真实推送生效。
6. 保存到当前群后仅该群生效。
7. 重载页面后配置仍正确。
8. 快速连续拖动不会出现旧预览覆盖新预览。

### 完整功能验收

1. 用户可以新增 tag。
2. 用户可以新增静态文本。
3. 用户可以创建容器。
4. 用户可以把元素拖入容器。
5. 用户可以调整容器内排序。
6. 用户可以在自由画布中任意摆放 tag 和文本。
7. 用户可以导入导出模板。
8. `video/dynamic/article/live/bangumi/user` 都支持主元素编辑。
9. WebUI 预览与实际推送使用同一模板渲染。
10. 任意异常配置不影响默认发图。

## 需要用户确认的决策

1. 第一阶段是否按“现有元素拖动和缩放”先落地，不立即做任意新增元素。
2. 是否接受自由布局默认允许重叠，只提示重叠风险，不强制自动避让。
3. 是否优先保证视频模板体验，再迁移其他类型。
4. 是否允许新增前端依赖：
   - `react-moveable`
   - `@dnd-kit/core`
   - `@dnd-kit/sortable`
5. 是否保留当前 `previewLayoutConfig` 配置名，并通过 `version: 2` 升级。

