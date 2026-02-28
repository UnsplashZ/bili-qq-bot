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

## Definition of Done

- Requested behavior implemented.
- Relevant tests/lint executed (or explicit reason provided if skipped).
- No unrelated files changed.
- User-facing summary includes changed files, risk notes, and verification results.
