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

## 2026-06-04 修正版执行边界

本节根据 2026-06-04 只读审核补充，是本轮完整实现的执行真源。原文中的 Phase 0-6 只作为内部施工顺序，不再代表可延期范围；本轮最终交付必须覆盖技术 Spike、现有元素拖动缩放、DSL v2、容器排序、新增元素、多类型迁移和设计器增强闭环。

### 当前代码合同复核结论

当前 live 合同仍是 v1 patch：

1. `src/services/previewLayout/schema.js` 中 `PREVIEW_LAYOUT_VERSION = 1`。
2. v1 `layout.mode` 只有 `flow`，只支持 `offsetX/offsetY/width/height/marginTop/marginBottom`。
3. `src/services/previewLayout/css.js` 通过 `[data-layout-key="..."]` 输出 width/height/margin 和 `transform: translate(...)`，没有 `x/y/zIndex/absolute`。
4. `src/dashboard/routes/api/modules/preview-layout.js` 的保存接口只接受 `patch`，预览接口只接受 `renderOverrides`；unknown top-level field 当前被测试约束为 400。
5. `dashboard/src/pages/PreviewLayoutEditor.jsx` 当前是固定元素列表、只读 overlay 和 v1 patch 属性面板，没有 `react-moveable`、`dnd-kit`、节点树、组件库、导入导出或 history。
6. 真实链接发图和订阅推送都走 `imageGenerator.generatePreviewCard()`；v2 renderer 必须接入这个入口，不能只接 dashboard 预览。
7. `docker-compose.yml` 默认使用远端 `unsplash/bili-qq-bot:latest`，本轮 Docker 验证必须显式使用本地构建镜像或临时 compose override。

### 施工顺序修正

本轮按以下顺序施工，但只有全部完成后才算交付：

1. 先前置 `previewTemplate` v2 后端协议与 renderer adapter。
2. 再把 v1 patch 迁移为 v2 template diff，保留 v1 API 兼容。
3. 再接 WebUI 设计器：树、组件库、画布 overlay、Moveable、dnd-kit、属性面板、history、导入导出。
4. 再迁移 `video/live/bangumi/article/dynamic/user` 全类型默认模板。
5. 最后执行独立代码审核、测试、浏览器 smoke 和 Docker 内验证。

不能走“v1 flow patch 上伪造 absolute”的路线。所有保存到 DSL 的自由布局坐标必须是输出坐标，最终由后端 v2 template renderer 输出 HTML/CSS，再由现有 Puppeteer 截图。

### v1/v2 API 兼容矩阵

沿用 `/api/preview-layout` 路径，新增 v2 字段时保留 v1 客户端兼容。

| 接口 | v1 输入 | v2 输入 | 响应要求 | 优先级 |
| --- | --- | --- | --- | --- |
| `GET /schema` | 无 | 无 | 返回 `version: 2`，同时包含 `legacyFieldGroups` 与 `templateNodeTypes/roles/bindings/controls` | 不适用 |
| `GET /config?type&groupId` | 无 | 无 | 返回 `template`、`source.globalTemplate`、`source.groupTemplate`、`legacyPatch`、`migratedFromVersion`、`scopeMeta` | v2 effective 为主，legacy 仅兼容展示 |
| `POST /config` | `patch` | `template` | 二者至少一个；只传 `patch` 时先迁移成 v2 后保存 | 同时存在时 `template` 胜出，`patch` 仅写入 `legacyBackup` |
| `POST /preview` | `renderOverrides` | `draftTemplate` | 二者至少一个；只传 `renderOverrides` 时迁移临时 draft | 同时存在时 `draftTemplate` 胜出 |
| `POST /reset` | `element` | `nodeId/resetScope` | 支持旧 `element` 映射到同名 v2 node；支持 node/template/group/global reset | `nodeId` 胜出 |
| `POST /template/validate` | 不适用 | `template` | 导入前校验，返回 normalized template 或错误 | 不保存 |

兼容窗口内 unknown field 测试需要更新：未知危险字段仍拒绝，但 `template/draftTemplate/nodeId/resetScope` 从 unknown 改为受控字段。v1 `patch/renderOverrides` 继续校验 size、类型和白名单，不允许绕过 v2 校验。

### 存储结构与迁移

继续使用 `previewLayoutConfig`，但版本升级为 2：

```json
{
  "version": 2,
  "legacyV1Backup": {},
  "global": {
    "video": {
      "template": {},
      "updatedAt": "2026-06-04T00:00:00.000Z"
    }
  },
  "groups": {
    "123456": {
      "video": {
        "templatePatch": {},
        "updatedAt": "2026-06-04T00:00:00.000Z"
      }
    }
  },
  "lastKnownGood": {
    "video": {}
  }
}
```

迁移规则：

1. 读取无版本或 `version: 1` 时，不直接覆盖旧配置，先深拷贝到 `legacyV1Backup`。
2. 对每个 type 加载内置 v2 默认模板，然后将 v1 `elements[key]` 映射到同名 node。
3. `visible` 映射到 node `visible`。
4. `layout.offsetX/offsetY` 映射到 node `layout.mode = "flow"` 下的 `transform.x/transform.y`，自动迁移阶段保持原 flow 占位；`absolute x/y` 只由新编辑器自由拖动/切换自由层时产生，基准取 renderer metadata 默认 box。
5. `layout.width/height` 映射到 `layout.width/height`。
6. `typography` 映射到 `style.fontSize/lineHeight/maxLines/maxHeight`。
7. `media` 映射到 `style.aspectRatio/objectFit/objectPosition/radius`。
8. 无法映射的字段记录 `PREVIEW_TEMPLATE migration-field-dropped`，局部丢弃；单个 type 迁移失败时回退该 type 内置模板，不影响其他 type 和发图。
9. 保存成功后写 `version: 2`，但保留 `legacyV1Backup` 供回滚和诊断。

### v1 flow patch 到 v2 flow/absolute 的精确算法

v1 `offsetX/offsetY` 是 flow 元素上的 `transform: translate(...)`，原节点仍占据文档流。v2 迁移不得把所有 offset 节点直接脱离文档流，否则会改变兄弟节点位置和容器高度。

迁移策略按字段分流：

1. 只有 `visible/typography/media/width/height/marginTop/marginBottom` 的 v1 patch，迁移为 v2 `layout.mode = "flow"`，保留原文档流。
2. 只有 `offsetX/offsetY` 的 v1 patch，默认迁移为 v2 `layout.mode = "flow"` 加 `transform.x/transform.y`，保持原 flow 占位语义。
3. 同时存在 `offsetX/offsetY` 与用户在新设计器中执行自由拖动后，才转为 `layout.mode = "absolute"`。
4. v1 -> v2 自动迁移阶段不把 flow 节点强制改成 absolute；absolute 只由新编辑器操作产生。

v2 layout 字段拆分：

```json
{
  "layout": {
    "mode": "flow",
    "width": 420,
    "height": 240,
    "marginTop": 8,
    "marginBottom": 8,
    "transform": {
      "x": 12,
      "y": -8
    }
  }
}
```

新编辑器把节点切到 absolute 时，必须先拿最近一次后端 metadata 里的默认 box：

```text
baseX = metadata.elements[nodeId].box.x
baseY = metadata.elements[nodeId].box.y
absoluteX = baseX + (layout.transform.x || 0) + userDragDeltaX
absoluteY = baseY + (layout.transform.y || 0) + userDragDeltaY
```

切换到 absolute 后：

1. 清空 `layout.transform`。
2. 写入 `layout.x/y/width/height/zIndex`。
3. 给原父容器写入 `layout.absoluteChildren = true`，renderer 将 absolute child 放入相同 container 的 positioned overlay 层。
4. 原 flow 占位不再由该节点承担；如果该节点是影响内容高度的主 flow 节点，renderer 必须用 container min-height 或 sibling flow 内容维持 `.container` 高度。
5. 对 `title/text/header/stats` 这类主内容节点，第一次自由拖动前仍保持 flow；只有用户明确拖动到自由层后才脱流。

回归样例：

1. v1 `title.layout.offsetY = -12` 迁移后，标题仍占据原 flow 高度，视觉上上移 12px，stats 不上移。
2. 用户在 v2 画布中拖动 title 到封面上方后，title 变成 absolute，stats 按原 flow 位置保留，title 不再挤占 stats。
3. v1 `cover.layout.height = 420` 迁移后仍是 flow cover，高度影响后续 content 位置。
4. v1 `typeBadge.visible=false` 迁移后不渲染或 display none，但不产生 absolute 坐标。

### group override 语义

v2 group 使用继承型 diff overlay，不使用完整快照作为默认存储。这样 global 模板演进不会被群组旧快照阴影覆盖。

合并顺序：

```text
builtInDefault(type)
  -> migrated/global template
  -> group templatePatch
  -> draftTemplate
```

group patch 支持以下操作：

```json
{
  "nodes": {
    "customTag_1": {
      "op": "add",
      "value": { "id": "customTag_1", "type": "tag", "parentId": "root" }
    },
    "title": {
      "op": "merge",
      "value": { "visible": false }
    },
    "deprecatedTag": {
      "op": "remove"
    }
  },
  "children": {
    "root": {
      "op": "order",
      "before": { "customTag_1": "content" },
      "after": { "typeBadge": "cover" },
      "remove": ["deprecatedTag"]
    }
  }
}
```

`templatePatch` 操作协议：

| op | 适用 | 语义 |
| --- | --- | --- |
| `add` | group 新增节点 | 新节点只存在于该 group effective template；必须提供完整 normalized node |
| `merge` | 修改继承节点或 group 自有节点 | 深合并字段；未出现字段继续继承 base |
| `remove` | 删除继承节点或 group 自有节点 | 写 tombstone；base 后续仍有该节点时 group effective 继续移除 |
| `reset` | 清除 group 节点覆盖 | 删除该 node 的 group patch/tombstone，重新继承 base |
| `move` | 改 parent | 修改 node `parentId`，并在 children patch 中记录顺序 |
| `reorder` | 改同父级顺序 | 只改 children patch，不改 node 字段 |

children patch 不是全量快照，必须用 diff 语义，避免 global 后续新增 child 被旧 group 数组遮蔽：

```json
{
  "children": {
    "root": {
      "op": "order",
      "before": { "customTag_1": "content" },
      "after": { "typeBadge": "cover" },
      "remove": ["deprecatedNode"]
    }
  }
}
```

children 合并算法：

1. 从 base children 顺序开始。
2. 移除 group tombstone 和 children.remove 中的节点。
3. 插入 group `add` 节点；若无 before/after，默认追加到 parent children 末尾。
4. 应用 before/after 相对排序；冲突时以后端 normalizer 稳定排序并记录 warn。
5. base 后续新增 child 若未被 group remove/tombstone 命中，仍保留在 effective children 中。
6. parent 被 remove 时，默认级联 remove 子树；若 group patch 中有 `move` 把子节点迁出，则迁出节点保留。

示例：

1. global 将 `title.style.fontSize` 从 30 改为 34，某 group 没有 title patch，则 group effective 自动变成 34。
2. group 保存 `title.visible=false` 后，global 再改 title 字号，group 仍隐藏 title，但其他 title 字段继续继承 global。
3. group 删除 global 新增的 `customTag_1` 时，写 `op: remove` tombstone；reset group node 后 tombstone 删除，节点重新继承 global。
4. group 把 `stats` 排到 `title` 前面时，只写 children order diff；global 后续新增 `subtitle` 仍会进入该 parent。

### v2 DSL normal form

后端 normalized template 使用 flat tree，`nodesById` 是节点真源，`childrenByParentId` 是顺序真源。前端可显示 nested tree，但保存前必须归一化。

```json
{
  "canvas": { "width": 1000, "height": "auto", "minHeight": 320, "maxHeight": 1600 },
  "rootId": "root",
  "nodesById": {
    "root": { "id": "root", "type": "container", "layout": { "mode": "stack" } },
    "title": { "id": "title", "type": "element", "role": "title", "parentId": "content" }
  },
  "childrenByParentId": {
    "root": ["cover", "content"],
    "content": ["header", "title", "stats"]
  }
}
```

校验规则：

1. node id 只能匹配 `/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/`，新增节点用 `node_${type}_${timestamp}_${seq}`。
2. `parentId` 必须存在，root 不能有 parent。
3. `childrenByParentId` 中的 child 必须存在且 parentId 反向一致。
4. 禁止循环、重复 child、超过 5 层容器嵌套、超过 80 个节点。
5. role 节点如 `title/cover/avatar/typeBadge` 默认每个 template 唯一；自定义 `text/tag/shape` 不要求 role。
6. 删除节点使用 patch tombstone，不把未知 HTML/CSS 留在配置里。
7. 用户输入文本只允许纯文本，后端 escape；不允许 HTML、JS、任意 CSS、`url(...)` 和不受控图片 URL。

### safe view model 与 binding

新增 `src/services/previewTemplate/bindings.js`，把原始 B 站返回数据转换成模板可读的 safe view model。模板只能读取白名单 path，不能访问 `data.data`、`render_payload` 或执行表达式。

通用字段：

```text
card.type
card.typeLabel
card.url
card.id
author.name
author.avatar
author.uid
author.verifyType
time.pubText
stats.views
stats.likes
stats.comments
stats.shares
```

类型字段：

| 类型 | 绑定源 | 不直接开放的内部结构 |
| --- | --- | --- |
| video | `video.title`, `video.cover`, `video.desc`, `video.duration` | 原始 rights/render_payload |
| dynamic | `dynamic.title`, `dynamic.text`, `dynamic.media`, `dynamic.embeddedTitle`, `dynamic.origText` | 原始 modules、blocked payload |
| article | `article.title`, `article.cover`, `article.summary`, `article.bodyPreview` | 原始 HTML 节点 |
| live | `live.title`, `live.cover`, `live.roomId`, `live.statusText` | 原始 room_info/anchor_info |
| bangumi | `bangumi.title`, `bangumi.cover`, `bangumi.progress`, `bangumi.statusLine` | 原始 season object |
| user | `user.name`, `user.avatar`, `user.signature`, `user.uid`, `user.recentDynamicText` | 最近动态原始 modules |

binding 只支持：

```json
{ "source": "video.title", "fallback": "视频标题", "format": "plainText" }
```

format 白名单：`plainText`、`numberCompact`、`dateText`、`duration`、`imageUrl`、`badgeText`。图片 URL 只能来自 safe view model 中已解析的 B 站图片或内置占位图。

### renderer adapter 与 fallback 决策表

`generatePreviewCardArtifacts()` 增加 template 选项，但保持旧 options 兼容：

```js
{
  renderOverrides,
  draftTemplate,
  collectElementMetadata,
  rendererMode: 'auto'
}
```

决策：

| 场景 | Dashboard preview | 真实推送 | metadata |
| --- | --- | --- | --- |
| 无 v2 template | 迁移 v1 draft 或 legacy renderer | legacy renderer + v1 overrides | legacy `data-layout-key` |
| v2 校验失败 | 返回 400，带校验错误 | 记录 warn，回退 lastKnownGood 或内置模板 | 返回 fallback 来源 |
| binding 缺字段 | 使用 fallback/空文本，记录 debug | 使用 fallback/空文本 | node 仍返回 visible/bounds |
| template renderer 抛错 | 返回 legacy fallback 预览并标注 `fallbackReason` | 回退 legacy renderer，不中断发图 | legacy metadata |
| Puppeteer 截图失败 | 返回 500 或现有错误 | 走现有文本降级链路 | 无 |
| metadata 采集失败 | 图片仍返回，metadata 标注错误 | 不影响发图 | 空 metadata |

日志事件名：

1. `PREVIEW_TEMPLATE migration-started/migration-failed/migration-field-dropped`
2. `PREVIEW_TEMPLATE normalize-failed`
3. `PREVIEW_TEMPLATE renderer-fallback`
4. `PREVIEW_TEMPLATE metadata-failed`
5. `PREVIEW_TEMPLATE saved-template-invalid-fallback`

renderer 输出要求：

1. 每个可定位节点输出 `data-template-node-id`。
2. 兼容节点继续输出同名 `data-layout-key`。
3. HTML 文本全部 escape。
4. CSS 只能由白名单字段生成。
5. `.container` 仍是 Puppeteer 截图目标。

### 多类型默认模板边界

每个类型都必须提供内置 v2 默认模板和结构示例 smoke。

| 类型 | 默认节点 | 不可编辑或受限子结构 |
| --- | --- | --- |
| video | `typeBadge/card/cover/content/header/avatar/authorName/pubTime/title/stats/text` | 富文本 emoji 由 binding/renderer 受控渲染 |
| live | `typeBadge/card/cover/content/header/avatar/authorName/roomId/liveBadge/title/stats` | 直播状态 badge 只改显示和样式，不改状态判断 |
| bangumi | `typeBadge/card/cover/content/title/statusLine/stats/text` | season 类型图标和 subtype 规则沿用现有逻辑 |
| article | `typeBadge/card/content/header/avatar/authorName/pubTime/decorationCard/cover/title/text/stats` | 正文 HTML 不开放任意编辑，只提供 summary/bodyPreview binding |
| dynamic | `typeBadge/card/content/header/avatar/authorName/pubTime/decorationCard/title/text/media/embeddedResource/supplementalCards/origCard/stats` | media、引用资源、转发卡作为受控 composite node |
| user | `typeBadge/card/content/header/avatar/authorName/uid/medal/signature/stats/dynamicSection/dynamicText/dynamicMedia/supplementalCards` | 最近动态内部结构作为 composite node，不开放原始 modules |

所有类型都支持新增 `container/text/tag/imagePlaceholder/stats/shape`。新增 `imagePlaceholder` 只能绑定 safe image source 或内置占位图。

### component registry 与默认节点

新增节点必须从后端 component registry 生成，前端只能提交 registry 中的 `componentType` 和受控 props。

| componentType | 默认 type | 允许 parent | 默认 binding | 删除规则 |
| --- | --- | --- | --- | --- |
| `container` | `container` | root/container | 无 | 级联删除子树，除非子节点被 move 到其他 parent |
| `staticText` | `text` | root/container | `{ "source": "static", "value": "自定义文本" }` | 删除自身 |
| `boundText` | `text` | root/container | `{ "source": "card.typeLabel", "fallback": "" }` | 删除自身 |
| `tag` | `tag` | root/container | `{ "source": "static", "value": "标签" }` | 删除自身 |
| `imagePlaceholder` | `image` | root/container | `{ "source": "card.placeholderImage", "format": "imageUrl" }` | 删除自身 |
| `stats` | `stats` | root/container | `items: ["views", "likes", "comments"]` | 删除自身和 stats item config |
| `shape` | `shape` | root/container | 无 | 删除自身 |

registry 同时定义：

1. 默认 `layout/style`。
2. 可编辑字段 schema。
3. 是否允许 children。
4. 是否允许 absolute。
5. 是否允许复制。
6. role 唯一性约束。
7. safe binding 候选列表。

前端组件库只能展示 registry 返回的组件。导入模板时后端按 registry 重新 normalize，未知 component/type 一律拒绝。

### safe view model 测试矩阵

每种类型必须补从当前 renderer 原始数据到 safe model 的字段映射测试。测试用例不要求覆盖全部 B 站原始字段，只覆盖模板允许访问的字段和复杂 composite 边界。

| 类型 | 必测字段 | 复杂边界 |
| --- | --- | --- |
| video | title/cover/desc/duration/author/stats | emoji/richtext title、充电专属标记只生成受控 badge |
| live | title/cover/roomId/statusText/author/stats | 直播中/未开播状态 badge |
| bangumi | title/cover/progress/statusLine/stats | movie/doc/guocha/tv/variety subtype label |
| article | title/cover/summary/bodyPreview/author/stats | 原始正文 HTML 转纯文本摘要，不透传 HTML |
| dynamic | title/text/media/embeddedTitle/origText/author/stats | blocked、media grid、embeddedResource、supplementalCards、origCard 都是 composite |
| user | name/avatar/signature/uid/recentDynamicText/stats | `show_id=false` 时 uid 条件节点隐藏；最近动态 media 和 supplemental 是 composite |

条件节点规则：

1. binding 为空或源字段不存在时，节点可显示 fallback；fallback 为空且 `hideWhenEmpty=true` 时不渲染。
2. `user.uid` 受 `show_id` 控制，`show_id=false` 时 metadata 返回 exists false 或 visible false。
3. dynamic 的 `media/embeddedResource/supplementalCards/origCard` 数据不存在时默认不渲染，但节点仍可在编辑器中显示为占位 overlay。
4. composite node 的内部 HTML 由 renderer 受控生成，属性面板只开放整体 layout/style/visible，不开放内部任意 HTML。

### 前端设计器完整交互合同

新增依赖：

1. `react-moveable`
2. `@dnd-kit/core`
3. `@dnd-kit/sortable`
4. `@dnd-kit/utilities`

依赖接入后必须跑 `npm --prefix dashboard run lint` 和 `npm --prefix dashboard run build`，确认 React 19/Vite 兼容。

WebUI 状态：

1. `draftTemplate` 是唯一编辑真源。
2. `history` 保存 normalized template 快照；拖动中不入栈，拖动结束入栈。
3. 每次 preview 请求带 `payloadKey`；旧响应不得覆盖新预览。
4. overlay 使用后端 metadata 对齐，拖动中只显示临时 transform。
5. 保存 global 写 full normalized template；保存 group 写相对 global 的 templatePatch。

必须落地 UI：

1. 左侧 tabs：节点树、组件库、图层。
2. 节点树支持 dnd-kit 排序、跨容器移动、显示/隐藏、锁定/解锁。
3. 组件库支持新增容器、静态文本、绑定文本、tag、图片占位、统计栏、shape。
4. 图层支持 absolute 节点上移、下移、置顶、置底。
5. 画布 overlay 支持 Moveable 拖动、缩放、吸附、多选基础能力。
6. 属性面板按 node type 显示布局、文字、图片、tag、容器、binding 字段。
7. 操作栏支持保存全局、保存群组、reset、导入、导出、撤销、重做、对齐、分布。
8. 重叠提示只提示不强制避让。
9. 窄屏下工具栏、画布和面板不得横向溢出。

### 模块落地清单

后端新增：

```text
src/services/previewTemplate/schema.js
src/services/previewTemplate/defaults.js
src/services/previewTemplate/normalizer.js
src/services/previewTemplate/migrator.js
src/services/previewTemplate/merge.js
src/services/previewTemplate/renderer.js
src/services/previewTemplate/css.js
src/services/previewTemplate/bindings.js
src/services/previewTemplate/metadata.js
src/services/previewTemplate/signature.js
```

后端改造：

1. `src/dashboard/routes/api/modules/preview-layout.js` 接受 v1/v2 兼容字段。
2. `src/services/imageGenerator/generators/previewCard.js` 接入 template renderer adapter。
3. `src/services/previewLayout/**` 保留为 v1 compatibility，不删除。
4. `src/services/subscription/updateChecker/modules/notify.js` 的 layout signature 改为 template effective signature，避免群组覆盖错图。

前端建议拆分：

```text
dashboard/src/pages/preview-layout/PreviewLayoutEditor.jsx
dashboard/src/pages/preview-layout/components/Canvas.jsx
dashboard/src/pages/preview-layout/components/NodeTree.jsx
dashboard/src/pages/preview-layout/components/ComponentPalette.jsx
dashboard/src/pages/preview-layout/components/LayerPanel.jsx
dashboard/src/pages/preview-layout/components/PropertyPanel.jsx
dashboard/src/pages/preview-layout/hooks/useTemplateHistory.js
dashboard/src/pages/preview-layout/utils/templateDraft.js
```

旧 `dashboard/src/pages/PreviewLayoutEditor.jsx` 可作为 route shell 或迁移入口。

### 测试与验收修正

最小相关测试：

```bash
./node_modules/.bin/mocha --exit \
  test/unit/preview-layout/preview-layout-core.test.js \
  test/unit/preview-template/preview-template-schema.test.js \
  test/unit/preview-template/preview-template-normalizer.test.js \
  test/unit/preview-template/preview-template-migrator.test.js \
  test/unit/preview-template/preview-template-merge.test.js \
  test/unit/preview-template/preview-template-renderer.test.js \
  test/unit/preview-template/preview-template-bindings.test.js \
  test/unit/dashboard/dashboard-preview-layout-api.test.js \
  test/unit/rendering/preview-template-rendering.test.js
npm --prefix dashboard run lint
npm --prefix dashboard run build
```

必要全量验证：

```bash
npm test
```

浏览器 smoke：

1. `/preview-layout` 打开无 console error。
2. `video/dynamic/article/live/bangumi/user` 结构示例都可预览。
3. 真实 B 站链接可预览。
4. 拖动、缩放、排序、新增 tag、新增文本、新增容器、导入导出、撤销重做、对齐分布均正常。
5. 保存全局和群组覆盖后刷新仍生效。
6. 普通链接解析真实发图和订阅推送使用保存模板。
7. 窄屏不溢出。

所有本地生成预览产物必须写入 `test/output/`。

### Docker 验证路径

不得直接用 `docker-compose.yml` 默认远端 image 当作本地改动验收。

步骤：

1. 本地构建镜像：

```bash
docker build -t bili-qq-bot:preview-template-local .
```

2. 优先使用临时 compose override 指向本地镜像：

```yaml
# docker-compose.preview-template-local.yml
services:
  bili-qq-bot:
    image: bili-qq-bot:preview-template-local
```

```bash
docker compose -f docker-compose.yml -f docker-compose.preview-template-local.yml up -d
```

3. 若使用 `docker run`，先确认 compose project 和网络名：

```bash
docker compose ps
docker network ls | grep bot_network
```

确认网络名后再执行：

```bash
docker compose up -d napcat
docker run --rm --name bili-qq-bot-preview-template \
  --network bili-qq-bot_bot_network \
  -p 3000:3000 \
  -v "$PWD/config:/app/config" \
  -v "$PWD/data:/app/data" \
  -v "$PWD/logs:/app/logs" \
  -v "$PWD/fonts/custom:/app/fonts/custom" \
  -v "$PWD/napcat/qq:/app/.config/QQ" \
  bili-qq-bot:preview-template-local
```

4. Docker 内验证：
   - dashboard 可访问并能登录。
   - `/preview-layout` API schema/config/preview 正常。
   - 全类型结构示例可预览。
   - 保存 global/group template 后 config 文件中为 v2。
   - `generatePreviewCard` 真实渲染链路使用保存模板。
   - 日志无 `renderer-fallback` 异常，除非该用例明确在测试 fallback。

Docker 验证失败不得宣称完成；必须修正或记录明确阻塞证据。
