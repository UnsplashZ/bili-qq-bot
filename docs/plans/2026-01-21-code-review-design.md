# 全项目 Code Review 方案

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:using-git-worktrees to isolate this review work.

**Goal:** 对项目核心代码进行一次“全面体检”，确保功能逻辑正常，并统一代码注释风格（简洁中文）。

**Review Strategy:** 全面审计 (Full Audit) + 先记录后修复 (Log then fix)。

---

### 1. 审查范围与分组

我们将代码库分为三个逻辑组进行逐一排查：

**Group 1: 核心服务层 (Backend Logic)**
重点检查业务逻辑、B站 API 调用封装、异常处理。
- `src/services/bili_service.py` (Python 核心脚本)
- `src/services/biliApi.js` (Node.js 适配器)
- `src/services/subscriptionService.js` (订阅管理)

**Group 2: Web API 路由层 (Express Routes)**
重点检查接口定义、参数校验、响应格式统一性。
- `src/web/routes/bilibili.js`
- `src/web/routes/groups.js`
- `src/web/routes/index.js`
- `src/web/app.js` (入口文件)

**Group 3: 前端交互层 (WebUI)**
重点检查 UI 逻辑、DOM 操作安全性、用户反馈。
- `src/web/public/js/app.js` (主逻辑)
- `src/web/public/js/api.js` (API 封装)
- `src/web/services/followingsCacheManager.js` (缓存逻辑)

### 2. 审查标准 (Checklist)

对于每个文件，执行以下检查：

**A. 功能与逻辑 (Functionality)**
- [ ] **异常处理**: 所有外部调用（API、文件IO）是否都有 `try-catch`？错误日志是否清晰？
- [ ] **健壮性**: 是否存在空指针风险（如 `obj.prop` 前未检查 `obj`）？
- [ ] **资源管理**: 文件句柄、定时器是否正确关闭/清理？
- [ ] **死代码**: 是否有注释掉的代码块或不再使用的函数？

**B. 注释风格 (Comments)**
- [ ] **标准**: 统一使用简洁中文注释 (`//` 或 `#`)。
- [ ] **覆盖率**: 核心函数头部应有 1 句话说明其作用。
- [ ] **准确性**: 删除过时或误导性的注释。

**C. 代码风格 (Style)**
- [ ] **命名**: Python 使用 `snake_case`，JS 使用 `camelCase`。
- [ ] **格式**: 缩进统一（JS 2空格/4空格，Python 4空格）。
- [ ] **硬编码**: 检查是否存在应移至配置文件的 Magic Strings/Numbers。

### 3. 执行流程

1.  **创建 Review 分支**: 使用 git worktree 创建干净环境。
2.  **逐个文件扫描**: 使用 Read 工具读取文件内容。
3.  **记录问题**: 将发现的问题记录到 `docs/plans/2026-01-21-code-review-findings.md`。
    -   格式：`[File] [Line] [Level] Description`
    -   Level: Critical (逻辑错误), Major (隐患/混乱), Minor (风格/注释)。
4.  **汇总报告**: Review 完成后，提交 findings 文档供用户确认。
5.  **后续修复**: 确认后，另行制定修复计划。

### 4. 输出文档

- `docs/plans/2026-01-21-code-review-design.md` (本文档)
- `docs/plans/2026-01-21-code-review-findings.md` (审查结果)
