# Agent Instructions for bili-qq-bot

This file is for coding agents. Keep behavior safe, minimal, and verifiable.

## Scope

- Default objective: complete the user's requested change end to end.
- Preserve existing behavior unless user explicitly asks to change it.
- Keep diffs focused. Do not refactor unrelated code.

## Project Snapshot

- Stack: Node.js (CommonJS) + Python service + React dashboard.
- Runtime protocol: NapCat / OneBot v11.
- Core modules:
  - `src/handlers/`: message pipeline (`messageHandler`, `linkHandler`, `aiHandler`)
  - `src/services/`: subscription, AI context/vector memory, Bilibili API bridge
  - `src/dashboard/`: backend API and auth for dashboard
  - `dashboard/src/`: frontend pages/components

## Non-Negotiable Editing Rules

- Read related files before editing. Match local code style and patterns.
- Keep edits minimal and local; avoid unrelated formatting changes.
- Never revert user changes you did not make.
- Never use destructive git commands unless explicitly requested.
- Prefer `rg`/`rg --files` for search.
- Use `logger.info/warn/error`; avoid `console.log` in backend code.
- For critical runtime JSON state, use atomic write helpers (`asyncWriteWithBackup`), not raw `writeFile`.
- When Puppeteer is required, default to using the locally installed Microsoft Edge browser.

## Language & Style Conventions

- Backend (`src/`): CommonJS (`require/module.exports`), no semicolons, 4-space indentation, `camelCase`.
- Frontend (`dashboard/src/`): components in `PascalCase`, hooks/utils in `camelCase`.
- Python (`src/services/bili_server.py`): PEP 8, `snake_case`, async handler style.

## Behavior-Safety Checks (High Risk)

- Always use `String(groupId)` for group-config key access.
- Call `ensureGroupConfig(groupId)` before group-config reads/writes.
- Ignore self messages to prevent bot echo loops (`self_id`).
- Preserve subscription tracking fields during refresh/merge; do not overwrite state blindly.
- Private chat path uses virtual group id format: `private_<userId>`.
- Watch for stale Python process occupying port `10001` when diagnosing API failures.

## Test & Verification Requirements

- Run tests/lint relevant to changed scope:
  - Backend: `node test/unit/<affected>.test.js`
  - Bulk backend sweep: `for f in test/unit/*.test.js; do node "$f"; done`
  - Dashboard: `cd dashboard && npm run lint`
- Keep tests deterministic and offline (no real external network calls).
- Any generated test artifacts (e.g., preview images, temporary outputs) must be written under `./test` only. Do not place test outputs in `docs/images` or other non-test directories.
- In final report, list what was run and what was not run.

## Useful Commands

```bash
# backend
npm install && npm start

# dashboard
cd dashboard && npm install && npm run dev
cd dashboard && npm run build
cd dashboard && npm run lint

# python bilibili service health
python3 src/services/bili_server.py --port 10001
curl http://localhost:10001/health
```

## Documentation Rule

Create a plan doc at `docs/plans/YYYY-MM-DD-<topic>.md` before implementation when change is cross-cutting (3+ files), architectural, or state/concurrency risky. Move finalized plan to `docs/done/` after completion.
When creating plan documents, provide the most complete actionable context available at planning time.

Required content in every plan:
- Requirement breakdown: restate goals, constraints, and success criteria in concrete terms.
- Boundaries and non-goals: clearly define what is in scope vs out of scope.
- Change map: pre-identify target files/modules and why each location needs change.
- Implementation approach: describe intended modification method per location (how to change, not only what to change).
- Risks and edge cases: list technical/product boundaries, failure modes, and compatibility concerns.
- Verification plan: define how changes will be validated (tests, checks, expected outcomes).
- Rollback plan: define how to revert safely if issues appear.
- Open questions/assumptions: explicitly mark unknowns and assumptions instead of leaving them implicit.

Guideline:
- Prefer maximum useful detail from currently available information.
- If information is missing, document assumptions and proceed with the safest verifiable plan.

## Response Structure Rule

- When presenting conclusion/explanation in chat, use a highly structured plain-text format for readability.
- Preferred section order:
  - `结论`
  - `逐项评估`
  - `方案选择（如有）`
  - `影响范围`
  - `待你确认`
- For each item in `逐项评估`, include:
  - `当前实现`
  - `数据是否可得`
  - `改动点（文件）`
  - `风险/边界`
  - `结论`
- If behavior change is involved, provide:
  - `选项A（保持现状）`
  - `选项B（改变行为）`
  - `推荐项与理由`
- Use code style markers for paths, function names, and field names.

## Commit Message Rules

- Branch-aware subject format:
  - On `main` branch: `vxx.yy.zz <summary>`
  - On non-`main` branches: `<type>: <summary>`
- On `main` branch, do not add type prefix in subject (`feat:`/`fix:`/etc.).
- Commit body is optional for both `main` and non-`main` branches.
- On `main` branch, before creating a commit, read the latest commit subject on `main`, parse `vxx.yy.zz` as the baseline version, then apply the bump policy below.
- Version bump policy for `vxx.yy.zz`:
  - Minor bug fix or small feature adjustment: increment `zz` by 1
  - Major feature adjustment: increment `yy` by 1 and reset `zz` to `0`
  - `xx` remains unchanged by default unless explicitly decided
- Examples:
  - `main`: `v1.4.3 修复订阅刷新超时问题`
  - non-`main`: `fix: 修复订阅刷新超时问题`

## Definition of Done

- Requested behavior implemented.
- Relevant tests/lint executed (or explicit reason provided if skipped).
- No unrelated files changed.
- User-facing summary includes changed files, risk notes, and verification results.
- In the wrap-up phase, perform a lightweight code review. If issues are found, report them with impacted scope and associated risks.
