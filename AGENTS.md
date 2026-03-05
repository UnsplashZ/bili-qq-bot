# Repository Guidelines

## Code Change Confirmation Rule

- Local documentation-only edits can proceed without prior approval.
- Documentation-only edits include writing/updating local `.md` docs (for example `README.md`, `docs/**`, `AGENTS.md`, `CLAUDE.md`) with no code/config/script/test changes.
- Any non-documentation code modification still requires explicit user approval first, including source files, scripts, configs, and tests.
- If a change mixes docs and code/config/script/test edits, get user approval before making any edits.

## Commit Message Rules

- Branch-aware subject format:
  - On `main` branch: `vxx.yy.zz <summary>`
  - On non-`main` branches: `<type>: <summary>`
- On `main` branch, do not add type prefix in subject (`feat:`/`fix:`/etc.).
- Commit body is required by default for both `main` and non-`main` branches.
- If you intentionally omit commit body, get explicit user approval first.
- On `main` branch, before creating a commit, read the latest commit subject on `main`, parse `vxx.yy.zz` as the baseline version, then apply the bump policy below.
- Version bump policy for `vxx.yy.zz`:
  - Minor bug fix or small feature adjustment: increment `zz` by 1
  - Major feature adjustment: increment `yy` by 1 and reset `zz` to `0`
  - `xx` remains unchanged by default unless explicitly decided
- Commit body formatting rule:
  - Use real newline characters; do not write literal `\n` inside a single `-m` string.
  - Prefer heredoc for multiline messages, for example:
    `git commit -F - <<'EOF' ... EOF`
  - If using `-m`, pass multiple `-m` flags for separate paragraphs instead of embedding escaped newlines.
- Examples:
  - `main`: `v1.4.3 修复订阅刷新超时问题`
  - non-`main`: `fix: 修复订阅刷新超时问题`

## Python Test Environment Rule

- Before running local Python tests, first check whether a local `venv` virtual environment exists.
- If `venv` exists, use that virtual environment for test execution.
- If `venv` does not exist, create it first and then run tests within that environment.

## Local Preview Output Rule

- For local testing that generates preview images, always write outputs to `./test/output`.
- Do not place such generated preview files in `./test/debug` or other directories unless the user explicitly requests otherwise.

## Test Script Tracking Rule

- `test/` 目录下文件主要用于本地功能验证脚本，默认不要求纳入版本控制。
- 若需要将某个测试脚本提交到仓库，需由用户明确提出。

## NapCat Interface Lookup Rule

- If a feature requires NapCat interfaces, first consult `docs/napcat_interface/llms.txt`.
- Use that index file to locate the corresponding interface documentation link and details.

## Review Quality & Reliability Rule

- For any review request, prioritize code quality and runtime reliability over style suggestions.
- Reviews should focus first on: bugs, regression risks, error handling gaps, edge cases, and missing/weak tests.
- For Node.js changes, pay special attention to async flow correctness (`await`/Promise chains), timeout and retry behavior, null/undefined safety, and resource cleanup.
- For Python changes, pay special attention to exception paths, I/O or async blocking risks, data validation, and cleanup of external resources.
- For CSS changes, verify layout stability and consistency (especially responsive behavior, overflow/truncation, and cross-module visual regressions).
- When tests or runtime checks cannot be executed, explicitly state the unverified parts and residual risk in the review output.

  
  ## read CLAUDE.md for more details on development commands, project architecture, and key directories.
