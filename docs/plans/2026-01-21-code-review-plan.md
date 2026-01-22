# Code Review Execution Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Perform a full code audit of the project to ensure logic correctness and unify comment styles (Chinese).

**Architecture:**
- **Phase 1: Audit:** Scan files group by group, logging issues to a findings markdown file.
- **Phase 2: Report:** Present the findings summary.
- **Phase 3: Fix (Future):** Separate plan to address the findings.

**Tech Stack:** Manual Code Review, Markdown for reporting.

---

### Task 1: Preparation & Group 1 Review (Backend Core)

**Files:**
- Create: `docs/plans/2026-01-21-code-review-findings.md`
- Read: `src/services/bili_service.py`
- Read: `src/services/biliApi.js`
- Read: `src/services/subscriptionService.js`

**Step 1: Initialize Findings Document**
Create `docs/plans/2026-01-21-code-review-findings.md` with the following header:
```markdown
# Code Review Findings (2026-01-21)

| File | Line | Level | Description |
|------|------|-------|-------------|
```

**Step 2: Review `src/services/bili_service.py`**
- Scan for exception handling gaps.
- Check comment style (should be Chinese).
- Append findings to the markdown table.

**Step 3: Review `src/services/biliApi.js`**
- Check Node-Python bridge error handling.
- Check hardcoded paths/timeouts.
- Append findings.

**Step 4: Review `src/services/subscriptionService.js`**
- Check subscription logic flow.
- Check for race conditions or unhandled promises.
- Append findings.

**Step 5: Commit Findings**
```bash
git add docs/plans/2026-01-21-code-review-findings.md
git commit -m "docs: start code review findings (Group 1)"
```

---

### Task 2: Group 2 Review (API Routes)

**Files:**
- Read: `src/web/routes/bilibili.js`
- Read: `src/web/routes/groups.js`
- Read: `src/web/routes/index.js`
- Modify: `docs/plans/2026-01-21-code-review-findings.md`

**Step 1: Review `src/web/routes/bilibili.js`**
- Check route definitions and middleware.
- Check response format consistency.
- Append findings.

**Step 2: Review `src/web/routes/groups.js`**
- Check group management logic permissions (if any).
- Check error responses.
- Append findings.

**Step 3: Review `src/web/routes/index.js`**
- Check main router structure.
- Append findings.

**Step 4: Commit Findings**
```bash
git add docs/plans/2026-01-21-code-review-findings.md
git commit -m "docs: update code review findings (Group 2)"
```

---

### Task 3: Group 3 Review (Frontend)

**Files:**
- Read: `src/web/public/js/app.js`
- Read: `src/web/public/js/api.js`
- Read: `src/web/services/followingsCacheManager.js`
- Modify: `docs/plans/2026-01-21-code-review-findings.md`

**Step 1: Review `src/web/public/js/app.js`**
- This is a large file. Check for:
    - Event listener duplication (memory leaks).
    - Null checks for DOM elements.
    - Comment clarity (Chinese).
- Append findings.

**Step 2: Review `src/web/public/js/api.js`**
- Check `fetch` wrapper error handling.
- Append findings.

**Step 3: Review `src/web/services/followingsCacheManager.js`**
- Check cache invalidation logic.
- Check file I/O safety.
- Append findings.

**Step 4: Commit Findings**
```bash
git add docs/plans/2026-01-21-code-review-findings.md
git commit -m "docs: complete code review findings (Group 3)"
```
