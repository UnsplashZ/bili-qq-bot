# 2026-03-01 未完成任务收敛计划（完成记录）

## 1. 背景

原 `docs/plans/` 下三份计划已在 `docs/done/` 落档，但样式统一阶段仍有收尾项。本次按低风险方案（方案B）执行：只做样式入口收敛与文档收口，不改业务逻辑与交互语义。

## 2. 本次处理策略

1. 将 `src/services/imageGenerator/renderers/user.js` 中静态内联样式迁移为 class。
2. 将对应 class 样式下沉到 `src/services/imageGenerator/core/theme.js`，保持视觉参数等价。
3. Type Badge 采用“样式来源统一、函数入口暂缓收敛”策略。
4. 计划文档迁移到 `docs/done/`，作为本轮唯一收口记录。

## 3. 实施结果

## 3.1 预览卡片样式统一（阶段2收尾）

1. 已完成：`user.js` 静态内联样式迁移为 class，原静态 `style=""` 从 34 处降为 0 处。
2. 已完成：`theme.js` 新增并接入用户卡片所需 class（头像、勋章、签名、统计栏、最近动态媒体块等）。
3. 已完成：仅保留结构/数据驱动逻辑，未引入新的用户可见语义变化。

## 3.2 样式入口收敛（低风险模式）

1. 已评估：Type Badge 样式来源已统一到设计系统 CSS（`.type-badge` / `.charging-mark`）。
2. 已落地结论：保持 `renderTypeBadge` 作为渲染函数入口，不做函数级强制合并。
3. 暂缓边界：`renderTypeBadge` 仍承载 `labelConfig` 可见性与充电标记语义，不在本轮改动范围内，避免引入开关行为风险。

## 3.3 文档收口

1. 已完成：本计划从 `docs/plans/` 迁移到 `docs/done/`。
2. 已完成：本文件作为本轮唯一收口记录，历史三份 2026-02-28 计划保持在 `docs/done/`。

## 4. 影响与风险

1. 业务逻辑影响：无（订阅、消息发送、API 契约未改动）。
2. 运行路径影响：无（仅渲染层样式组织方式变化）。
3. 可见风险：若 class 漏配可能导致局部错位；本次通过“数值等价迁移”控制风险。

## 5. 验证记录

1. 已执行静态检查：`user.js` 中 `style=""` 计数为 0。
2. 已执行语法检查：`node --check` 覆盖 `user.js`、`theme.js`、`previewCard.js`，均通过。
3. 未完成渲染 smoke test：技能脚本 `--with-smoke-tests` 失败，原因是仓库缺失 `test/unit/renderMediaHtml-imageTag.test.js`。
4. 未完成本地出图验证：技能脚本直接渲染失败，原因是环境缺少依赖 `dotenv`（当前工作区依赖未完整安装）。

## 6. 回滚说明

可按文件粒度回滚以下修改，不影响业务流程：

1. `src/services/imageGenerator/renderers/user.js`
2. `src/services/imageGenerator/core/theme.js`
3. `docs/done/2026-03-01-unfinished-tasks-consolidation-plan.md`

## 7. 完成标准核对

1. `user.js` 静态内联样式迁移完成，视觉参数按等价值迁移处理。
2. Type Badge 样式入口收敛已形成明确结论（样式完成收敛，函数入口暂缓并记录边界）。
3. 本计划已迁移至 `docs/done/`，`docs/plans/` 不再残留本计划文件。
