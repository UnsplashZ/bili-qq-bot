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

  
  ## read CLAUDE.md for more details on development commands, project architecture, and key directories.
