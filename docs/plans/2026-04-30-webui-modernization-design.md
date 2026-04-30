# WebUI 现代化改版功能设计

## 背景

当前 WebUI 的主体功能已经可用，但视觉层级偏旧，部分页面存在玻璃拟态、胶囊按钮、胶囊状态、大号指标块混用的问题。群组页的 tab 切换也偏生硬，缺少连续过渡反馈。

本设计文档基于 `test/output/2026-04-30-webui-style-preview-v2.html` 中已确认的预览方向，用于指导后续正式落地到 `dashboard/src`。

## 目标

- 统一 WebUI 的现代控制台风格，保持简洁、克制、有设计感，但不喧宾夺主。
- 保留深色中文界面，不做主题切换和多语言适配。
- 减少胶囊式 UI、嵌套卡片、大号 KPI 区块和说明性宣传文案。
- 提升 tab 切换体验，使用平滑下划线和面板滑入淡入过渡。
- 让群组管理、系统设置、Agent 管理、运行状态等页面使用一致的结构语言。

## 非目标

- 不重构业务 API。
- 不改变现有配置字段语义。
- 不引入浅色模式、多语言、品牌营销页或复杂动效框架。
- 不把所有页面强行做成同一种布局；群组管理保留群组上下文选择，设置类页面保持平铺。

## 设计原则

### 视觉

- 深色背景使用低对比网格与轻微青色光感，作为页面氛围，不抢内容。
- 主色采用克制青色，用于当前项、重点状态和主按钮。
- 面板以细边框、轻背景、低阴影表达层级。
- 圆角控制在约 `6px-8px`，避免大面积胶囊造型。
- 不使用大号 KPI 卡片。数据以表格、行内值或报表呈现。

### 信息层级

- 页面标题只保留必要名称。
- 标题旁的说明、面板标题下的介绍性文案默认移除。
- 解释性文字放在具体设置项备注中。
- 危险操作可以用左侧色条或状态文本提示，但不做强视觉警告块。

### 交互

- 主导航使用左侧细色条标识当前页面。
- 群组页 tab 使用下划线 active indicator。
- tab 内容切换使用方向感过渡：旧内容轻微淡出，新内容滑入、淡入。
- 支持 `prefers-reduced-motion`，动效可降级。

## 页面设计

### 运行状态

保留原有系统状态监控，并增加过程报表。

结构：

- 系统资源表格
  - CPU 负载
  - 内存使用
  - 网络流量
  - 运行时间
- CPU / 内存趋势图
  - 使用克制条形或面积趋势，不使用大号仪表盘。
- 过程报表
  - 链接解析
  - 预览生成
  - 订阅推送
  - 视频下载
  - AI 回复
  - 工具调用
  - 失败重试

过程数据只作为报表展示，不做表单式详情。

### 群组管理

保留左右结构，因为群组选择是页面上下文。

左侧：

- 群组列表
- 当前群组使用左侧细色条和轻背景标识
- 状态使用文本表达，例如 `启用`、`继承`、`禁用`

右侧：

- 群组标题和保存状态
- tab：常规、订阅、权限、关注同步、视频下载
- tab 内容使用设置行、表格、细分隔线
- 不使用摘要行、大号数字区块或胶囊式状态堆叠

### 系统设置

不做二级菜单。采用全宽平铺结构。

设置项按模块自然分组，但仍在同一页面内展示：

- 常规设置
- B站全局账号
- 全局黑名单
- 视频下载默认配置
- 系统控制

每个设置项一行：

- 左侧：名称和备注
- 中间：输入框、选择框或空占位
- 右侧：状态文本或方形状态控件

### Agent 管理

不做二级菜单。采用全宽平铺结构。

设置项直接平铺：

- 参与机制总开关
- Timing Gate
- 最长等待
- 回复字数上限
- 社交模式
- 表达学习
- 回复效果观察
- 工具风险等级

Agent 页可保留必要的状态文本，例如 `策略已加载`、`预算正常`，但不增加大段解释。

### 系统日志

沿用工具型界面：

- 顶部过滤控件保持紧凑。
- 日志主体使用表格/等宽文本布局。
- 等级、Channel、Scope、消息内容以列结构展示。
- 避免彩色胶囊过多堆叠；等级可用文本色或细边线区分。

## 组件建议

### App Shell

统一 `Layout` 与 `MobileMenu` 的导航配置，避免重复维护。

建议抽象：

- `NAV_ITEMS`
- `SidebarNavItem`
- `MobileNavItem`

### Surface

替代现有偏玻璃化的 `GlassCard` 风格。

建议语义：

- `Surface`
- `SurfaceHeader`
- `SurfaceBody`

样式要点：

- `border: 1px solid rgba(...)`
- `background: rgba(16, 22, 32, 0.88)`
- `border-radius: 8px`
- 避免强 blur 和厚重阴影

### Setting Row

用于系统设置、Agent 管理、群组 tab 内部配置。

结构：

- title
- description
- control
- status

行为：

- 行之间使用细分隔线。
- checkbox/switch 使用方形状态控件或现有可访问表单控件定制。
- 状态使用文本，不用胶囊。

### Tabs

用于群组页和少量需要局部切换的页面。

要求：

- active 下划线平滑移动。
- panel 使用滑入淡入过渡。
- 切换方向根据 tab index 判断。
- 减少面板内容的整体重排。

## 数据展示

### 禁用形态

- 大号 KPI 卡片
- 胶囊套胶囊
- 页面说明型文案堆叠
- 无必要的二级菜单

### 推荐形态

- 表格
- 设置行
- 行内状态文本
- 小号趋势图
- 细边线分隔

## 落地范围

预计涉及：

- `dashboard/src/index.css`
- `dashboard/src/components/Layout.jsx`
- `dashboard/src/components/MobileMenu.jsx`
- `dashboard/src/components/GlassCard.jsx` 或新增替代组件
- `dashboard/src/pages/Dashboard.jsx`
- `dashboard/src/pages/Groups.jsx`
- `dashboard/src/pages/groups/components/**`
- `dashboard/src/pages/Settings.jsx`
- `dashboard/src/pages/settings/components/**`
- `dashboard/src/pages/AgentSettings.jsx`
- `dashboard/src/pages/Logs.jsx`

如果实际改动中发现某些页面复杂度较高，可按页面分批落地：

1. 全局视觉基础与导航
2. 群组管理
3. 系统设置与 Agent 管理
4. 运行状态与系统日志

## 验收标准

- 页面没有明显胶囊堆叠。
- 设置页和 Agent 页无二级菜单，采用平铺配置行。
- 群组 tab 切换有平滑过渡，不再硬切。
- 运行状态页保留系统资源监控，并新增过程报表。
- 页面标题区域不包含冗余说明文案。
- 移动端不出现横向溢出或按钮文字挤压。
- 构建通过：

```bash
cd dashboard
npm run lint
npm run build
```

## 预览参考

当前确认方向的本地预览：

- `test/output/2026-04-30-webui-style-preview-v2.html`

相关截图：

- `test/output/2026-04-30-webui-v2-no-summary-desktop.png`
- `test/output/2026-04-30-webui-v2-settings-clean-copy.png`
- `test/output/2026-04-30-webui-v2-agent-clean-copy.png`
- `test/output/2026-04-30-webui-v2-status-monitor-report.png`
