# Dynamic 富文本与附加卡片实现参考

本文基于 `dynamic-bot` 当前实现整理，目标是帮助你在另一个项目中复刻类似的动态渲染效果（含 `@`、话题、投票、网页、BV、商品、附加卡片等）。

## 1. 整体链路

系统采用标准流水线：

1. 获取动态数据（列表或详情）
2. 反序列化为结构化模型（`ModuleDynamic`、`ContentDesc.RichTextNode`、`Additional`）
3. 按业务规则过滤/加工（订阅过滤、历史去重、翻译扩展）
4. 渲染为图片卡片（模块顺序拼装）
5. 发送文本/图片消息（文本走简化策略，图片走富文本策略）

---

## 2. 数据获取

### 2.1 动态接口

动态相关 API 常量：

```kotlin
const val NEW_DYNAMIC = "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all"
const val SPACE_DYNAMIC = "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space"
const val DYNAMIC_DETAIL = "https://api.bilibili.com/x/polymer/web-dynamic/v1/detail"
```

位置：`src/main/kotlin/top/bilibili/api/Api.kt`

请求实现（保留 `features=itemOpusStyle`）：

```kotlin
suspend fun BiliClient.getNewDynamic(page: Int = 1, type: String = "all"): DynamicList? {
    return getData(NEW_DYNAMIC) {
        parameter("timezone_offset", "-480")
        parameter("type", type)
        parameter("page", page)
        parameter("features", "itemOpusStyle")
    }
}

suspend fun BiliClient.getDynamicDetail(did: String): DynamicItem? {
    return getData<DynamicDetail>(DYNAMIC_DETAIL) {
        parameter("timezone_offset", "-480")
        parameter("id", did)
        parameter("features", "itemOpusStyle")
    }?.item
}
```

位置：`src/main/kotlin/top/bilibili/api/Dynamic.kt`

### 2.2 两条入口链路

1. 推送链路：定时调用 `getNewDynamic()`，筛选后投递到 `dynamicChannel`
2. 解析链路：链接解析时调用 `getDynamicDetail(id)`，单条渲染

推送筛选示例（类型过滤、时间过滤、历史去重、订阅过滤）：

```kotlin
val dynamics = dynamicList.items
    .filter { !banType.contains(it.type) }
    .filter { it.time > lastDynamic }
    .filter { !historyDynamic.contains(it.did) }
    .filter {
        if (listenAllDynamicMode) true
        else if (it.type == DynamicType.DYNAMIC_TYPE_PGC || it.type == DynamicType.DYNAMIC_TYPE_PGC_UNION)
            bangumi.contains(it.modules.moduleAuthor.mid)
        else followingUsers.contains(it.modules.moduleAuthor.mid)
    }
    .sortedBy { it.time }
```

位置：`src/main/kotlin/top/bilibili/tasker/DynamicCheckTasker.kt`

---

## 3. 数据模型设计

核心结构是 `ModuleDynamic`：

```kotlin
data class ModuleDynamic(
    @SerialName("additional") val additional: Additional? = null,
    @SerialName("desc") val desc: ContentDesc? = null,
    @SerialName("major") val major: Major? = null,
    @SerialName("topic") val topic: Topic? = null,
)
```

位置：`src/main/kotlin/top/bilibili/data/Dynamic.kt`

### 3.1 附加卡片 `additional`

`additional.type` 支持：

1. `ADDITIONAL_TYPE_COMMON`
2. `ADDITIONAL_TYPE_RESERVE`
3. `ADDITIONAL_TYPE_VOTE`
4. `ADDITIONAL_TYPE_UGC`
5. `ADDITIONAL_TYPE_GOODS`
6. `ADDITIONAL_TYPE_UPOWER_LOTTERY`

`common`（你提到的“相关游戏”就在这里）关键字段：

```kotlin
data class Common(
    @SerialName("id_str") val idStr: String,
    @SerialName("title") val title: String,
    @SerialName("cover") val cover: String,
    @SerialName("sub_type") val subType: String,   // 例如 game/ogv/decoration...
    @SerialName("desc1") val desc1: String,
    @SerialName("desc2") val desc2: String,
    @SerialName("head_text") val headText: String, // 例如“相关游戏”
    @SerialName("jump_url") val jumpUrl: String,
    @SerialName("style") val style: Int,
    @SerialName("button") val button: Button,
)
```

### 3.2 富文本节点 `desc.rich_text_nodes`

定义支持：

1. `RICH_TEXT_NODE_TYPE_TEXT`
2. `RICH_TEXT_NODE_TYPE_EMOJI`
3. `RICH_TEXT_NODE_TYPE_AT`
4. `RICH_TEXT_NODE_TYPE_TOPIC`
5. `RICH_TEXT_NODE_TYPE_WEB`
6. `RICH_TEXT_NODE_TYPE_VOTE`
7. `RICH_TEXT_NODE_TYPE_LOTTERY`
8. `RICH_TEXT_NODE_TYPE_BV`
9. `RICH_TEXT_NODE_TYPE_GOODS`

字段：

```kotlin
data class RichTextNode(
    @SerialName("type") val type: String,
    @SerialName("orig_text") val origText: String,
    @SerialName("text") val text: String,
    @SerialName("rid") val rid: String? = null,
    @SerialName("jump_url") val jumpUrl: String? = null,
    @SerialName("emoji") val emoji: Emoji? = null,
)
```

### 3.3 模块级话题 `topic`

```kotlin
data class Topic(
    @SerialName("id") val id: Int,
    @SerialName("name") val name: String,
    @SerialName("jump_url") val jumpUrl: String,
)
```

---

## 4. 处理与加工

### 4.1 文本模式与图片模式分离

项目里“文本消息”与“图片渲染”策略是分开的：

1. 文本消息：大量场景直接取 `desc.text` / 各 `major.title`（不走节点样式）
2. 图片消息：严格走 `rich_text_nodes` 渲染

文本侧示例：

```kotlin
DYNAMIC_TYPE_WORD,
DYNAMIC_TYPE_DRAW -> modules.moduleDynamic.desc?.text
    ?: modules.moduleDynamic.major?.blocked?.hintMessage
    ?: (modules.moduleDynamic.major?.opus?.title + "\n" + modules.moduleDynamic.major?.opus?.summary?.text)
```

位置：`src/main/kotlin/top/bilibili/tasker/DynamicMessageTasker.kt`

### 4.2 翻译加工（可选）

在渲染正文时，如果翻译开启，会把“分割线 + 译文”追加成新节点：

```kotlin
val traCutLineNode = ModuleDynamic.ContentDesc.RichTextNode(
    "RICH_TEXT_NODE_TYPE_TEXT",
    BiliConfigManager.config.translateConfig.cutLine,
    BiliConfigManager.config.translateConfig.cutLine
)
val tra = trans(text)
val nodes = if (tra != null) {
    richTextNodes.plus(traCutLineNode).plus(
        ModuleDynamic.ContentDesc.RichTextNode("RICH_TEXT_NODE_TYPE_TEXT", tra, tra)
    )
} else richTextNodes
```

位置：`src/main/kotlin/top/bilibili/draw/DynamicModuleDraw.kt`  
翻译实现：`src/main/kotlin/top/bilibili/utils/translate/TransApi.kt`

---

## 5. 渲染实现

### 5.1 模块拼装顺序

模块顺序固定：

```kotlin
topic?.drawGeneral(session)?.let { add(it) }
desc?.drawGeneral(session)?.let { add(it) }
major?.makeGeneral(session, isForward)?.let { add(it) }
additional?.makeGeneral(session)?.let { add(it) }
```

位置：`src/main/kotlin/top/bilibili/draw/DynamicModuleDraw.kt`

这直接决定显示效果是：

1. 话题（可选）
2. 正文富文本
3. 主卡（视频/图文/专栏等）
4. 附加卡（相关游戏/投票卡/商品卡等）

### 5.2 话题渲染效果

`topic` 单独绘制：`TOPIC.svg` 图标 + 话题名（链接色）。

```kotlin
val svg = loadSVG("icon/TOPIC.svg")
canvas.drawImage(iconImage, x, y - quality.contentFontSize * 0.9f)
canvas.drawTextArea(topicName, textCardRect, x, y, font, linkPaint)
```

### 5.3 富文本节点渲染分发

关键分支：

```kotlin
when (it.type) {
    "RICH_TEXT_NODE_TYPE_TEXT" -> { ... generalPaint ... }
    "RICH_TEXT_NODE_TYPE_EMOJI" -> { ... 下载 emoji.iconUrl 后贴图 ... }
    "RICH_TEXT_NODE_TYPE_WEB",
    "RICH_TEXT_NODE_TYPE_VOTE",
    "RICH_TEXT_NODE_TYPE_LOTTERY",
    "RICH_TEXT_NODE_TYPE_BV" -> {
        val svg = loadSVG("icon/${it.type}.svg")
        ... 先画图标，再画 linkPaint 文本 ...
    }
    else -> { ... linkPaint 文本 ... } // 包含 AT/TOPIC/GOODS
}
```

位置：`src/main/kotlin/top/bilibili/draw/DynamicModuleDraw.kt`

### 5.4 附加卡片渲染分发

`additional.type` -> `drawAdditionalCard(...)`：

```kotlin
when (type) {
    "ADDITIONAL_TYPE_COMMON" -> drawAdditionalCard(session, common!!.headText, common.cover, common.title, common.desc1, common.desc2)
    "ADDITIONAL_TYPE_RESERVE" -> ...
    "ADDITIONAL_TYPE_VOTE" -> ...
    "ADDITIONAL_TYPE_UGC" -> ...
    "ADDITIONAL_TYPE_GOODS" -> ...
    "ADDITIONAL_TYPE_UPOWER_LOTTERY" -> ...
}
```

当前效果特点：

1. `COMMON`（相关游戏）显示 `headText + cover + title + desc1 + desc2`
2. `VOTE` 附加卡显示 `“投票” + vote.desc + 结束时间`
3. `GOODS` 默认只显示 `items[0]`（首个商品）

### 5.5 文本换行与 emoji 细节

`drawTextArea(...)` 按字符逐个测宽，超宽自动换行；emoji 分两条路径：

1. 有系统 emoji 字体：直接字形渲染
2. 无字体：走 Twemoji 图片下载渲染

关键代码位置：`src/main/kotlin/top/bilibili/draw/DynamicModuleDraw.kt`

---

## 6. 显示效果对照表

| 类型 | 数据来源 | 样式 |
|---|---|---|
| 话题模块 | `module_dynamic.topic` | `TOPIC.svg` + 链接色文本 |
| `@用户` | `rich_text_nodes(type=AT)` | 链接色文本（当前无专属图标） |
| `#话题#` 节点 | `rich_text_nodes(type=TOPIC)` | 链接色文本（当前无专属图标） |
| 网页链接 | `rich_text_nodes(type=WEB)` | 图标 + 链接色文本 |
| 投票节点 | `rich_text_nodes(type=VOTE)` | 图标 + 链接色文本 |
| BV 节点 | `rich_text_nodes(type=BV)` | 图标 + 链接色文本 |
| 商品节点 | `rich_text_nodes(type=GOODS)` | 链接色文本（当前无专属图标） |
| 附加投票卡 | `additional.vote` | 独立附加卡（标题+结束时间） |
| 相关游戏卡 | `additional.common` | 独立附加卡（headText/cover/title/desc） |

---

## 7. 在新项目复刻的建议实现

### 7.1 推荐架构

1. `fetch`: 仅负责 API 请求与重试
2. `model`: 1:1 映射服务端字段（尤其 `rich_text_nodes` 和 `additional`）
3. `pipeline`: 过滤、去重、翻译、回退策略
4. `renderer`: 节点分发器 + 模块拼装器
5. `output`: 图片输出 + 文本输出（分离）

### 7.2 最小可复刻伪代码

```kotlin
fun renderDynamic(item: DynamicItem): Image {
    val blocks = mutableListOf<Image>()
    item.modules.moduleDynamic.topic?.let { blocks += renderTopic(it) }
    item.modules.moduleDynamic.desc?.let { blocks += renderRichText(it) }
    item.modules.moduleDynamic.major?.let { blocks += renderMajor(it) }
    item.modules.moduleDynamic.additional?.let { blocks += renderAdditional(it) }
    return compose(blocks)
}
```

```kotlin
fun renderRichNode(node: RichTextNode): InlineSpan {
    return when (node.type) {
        TEXT -> text(node.text, normalColor)
        EMOJI -> emoji(node.emoji.iconUrl)
        WEB, VOTE, LOTTERY, BV -> icon(node.type) + text(node.text, linkColor)
        else -> text(node.text, linkColor) // AT/TOPIC/GOODS fallback
    }
}
```

### 7.3 必做的降级策略

1. 图标不存在时，退化为链接色文字
2. emoji 下载失败时，退化为原始文本 emoji
3. `additional` 某类型字段缺失时，跳过该卡片而非中断整张图
4. 未知 `rich_text_nodes.type` 一律走 `else`（链接色文本）

---

## 8. 资源与配置要点

1. 图标目录：`src/main/resources/icon/`
2. 当前已内置：`TOPIC.svg`、`RICH_TEXT_NODE_TYPE_WEB.svg`、`RICH_TEXT_NODE_TYPE_VOTE.svg`、`RICH_TEXT_NODE_TYPE_LOTTERY.svg`、`RICH_TEXT_NODE_TYPE_BV.svg`
3. 翻译开关：`enableConfig.translateEnable`
4. 翻译分割线：`translateConfig.cutLine`

配置位置：`src/main/kotlin/top/bilibili/BiliConfig.kt`

---

## 9. 可选增强项（迁移时推荐）

1. 给 `AT/TOPIC/GOODS` 增加专属图标分支，视觉更统一
2. 利用 `jump_url` 生成可点击热区（如果你的渲染目标支持）
3. `GOODS` 支持多商品横向列表，而非只取 `items[0]`
4. 把“样式规则表”配置化（JSON/YAML），便于运营调整

---

## 10. 关键源码索引

1. 动态 API：`src/main/kotlin/top/bilibili/api/Dynamic.kt`
2. 动态模型：`src/main/kotlin/top/bilibili/data/Dynamic.kt`
3. 推送检查：`src/main/kotlin/top/bilibili/tasker/DynamicCheckTasker.kt`
4. 文本消息构造：`src/main/kotlin/top/bilibili/tasker/DynamicMessageTasker.kt`
5. 动态总渲染：`src/main/kotlin/top/bilibili/draw/DynamicDraw.kt`
6. 富文本与附加卡：`src/main/kotlin/top/bilibili/draw/DynamicModuleDraw.kt`
7. 链接解析入口：`src/main/kotlin/top/bilibili/service/ResolveLinkService.kt`
8. 图标资源：`src/main/resources/icon/`
9. 翻译实现：`src/main/kotlin/top/bilibili/utils/translate/TransApi.kt`

