# 2026-03-06 移除 `/管理 新对话` 变更记录

## 目标

- 移除 Root 管理命令中的 `/管理 新对话`（以及 `/admin newchat`）能力。
- 保留 `/管理 群列表`、`/管理 清理` 两个子命令不变。

## 变更范围

### 代码变更

1. `src/commands/admin.js`
- 删除 `aiHandler` 依赖。
- 删除 `subCommand === '新对话' || subCommand === 'newchat'` 分支。
- 其余管理子命令逻辑保持不变。

### 测试变更

1. `test/unit/admin-command-remove-newchat.test.js`（新增）
- 验证 `/管理 新对话 2000` 不再触发 `aiHandler.resetContext`。
- 验证 `/admin newchat 2000` 不再触发 `aiHandler.resetContext`。
- 验证两者均回到“未知指令。可用: /管理 <群列表|清理> [群号]”提示。

## 行为变化

- 变更前：
  - Root 用户可通过 `/管理 新对话 [群号]` 重置指定群 AI 上下文。
- 变更后：
  - `/管理` 仅支持 `群列表|清理`（以及英文别名 `list|clean`）。
  - AI 上下文重置统一通过 `/AI 新对话 [群号]` 入口处理。

## 验证记录

- 执行命令：
  - `node test/unit/admin-command-remove-newchat.test.js`
- 结果：
  - 通过（2/2）。

## 影响评估

- 对话上下文重置能力未删除，仅移除 `/管理` 旁路入口。
- 命令入口职责更清晰，避免管理命令和 AI 命令能力重叠。
