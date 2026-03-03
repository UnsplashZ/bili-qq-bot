# Repository Guidelines

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

  
  ## read CLAUDE.md for more details on development commands, project architecture, and key directories.