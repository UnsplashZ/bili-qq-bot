# P0 Release Readiness Adjustment Plan

> Date: 2026-05-21
> Scope: P0 issues identified from the project construction review.
> Status: Executed in working tree on 2026-05-21; pending commit/release workflow.

## 1. Background

The project already has a relatively complete product structure: Node bot runtime, Python Bilibili service, React Dashboard, Docker deployment, GitHub release automation, Agent runtime, and broad unit test coverage.

The current P0 risk is not feature completeness. The main risk is that release engineering, runtime version declarations, and documentation state are not fully aligned with the current project maturity.

## 2. Goals

- Add a release validation gate before Docker image publishing.
- Align local development, CI, Docker, and documentation on the Node.js version requirement.
- Reduce documentation ambiguity by moving completed plan documents out of the active plan directory.

## 3. Non-Goals

- Do not change runtime business logic.
- Do not redesign Agent behavior, Bilibili parsing, subscription logic, or Dashboard UI.
- Do not change deployment topology or Docker runtime behavior beyond CI validation.
- Do not create commits, branches, tags, pushes, or releases as part of this plan.

## 4. Current Evidence

Local verification on 2026-05-21:

- `npm test`: 130 JS/MJS unit test files passed after allowing local port binding.
- `venv/bin/python -m pytest test/unit/bilibili`: 33 Python tests passed.
- `cd dashboard && npm run lint`: passed.
- `cd dashboard && npm run build`: passed, with a Vite chunk-size warning for the main JS bundle.

Observed P0 gaps:

- `.github/workflows/docker-image.yml` builds and publishes Docker images on `main`, but does not run the full validation suite before publishing.
- README still advertises Node `>=18`, while the Dashboard Vite dependency requires `^20.19.0 || >=22.12.0`; Docker already uses Node 22.
- `docs/plans/` contains completed Agent planning documents, which makes active planning state less clear.

## 5. Phase 1: Add Release Validation Gate

### 5.1 Target Files

- `.github/workflows/docker-image.yml`

### 5.2 Intended Changes

Add a `validate` job before `build-push`.

The validation job should run:

1. Root Node dependencies and tests:
   - `npm ci`
   - `npm test`
2. Python Bilibili tests:
   - set up Python
   - `python -m pip install -r requirements.txt`
   - `python -m pytest test/unit/bilibili`
3. Dashboard checks:
   - `npm ci` in `dashboard`
   - `npm run lint` in `dashboard`
   - `npm run build` in `dashboard`

Then make `build-push` depend on the validation job:

```yaml
build-push:
  needs: validate
```

### 5.3 Notes

- Prefer Node 22 in CI to match Docker.
- Use GitHub Actions cache for npm where practical.
- Keep the release version extraction logic unchanged.
- Do not publish Docker image if validation fails.

### 5.4 Verification

- Run the same commands locally before pushing any future change:
  - `npm test`
  - `venv/bin/python -m pytest test/unit/bilibili`
  - `cd dashboard && npm run lint`
  - `cd dashboard && npm run build`
- After CI changes are committed in a future approved workflow, confirm GitHub Actions shows `validate` passing before `build-push`.

## 6. Phase 2: Align Node Version Requirement

### 6.1 Target Files

- `.nvmrc`
- `package.json`
- `dashboard/package.json`
- `README.md`

### 6.2 Intended Changes

Add `.nvmrc`:

```text
22
```

Add `engines` to root `package.json`:

```json
"engines": {
  "node": ">=22.12.0"
}
```

Add the same `engines` field to `dashboard/package.json`.

Update README Node badge and development wording from Node `>=18` to Node `>=22.12.0` or "Node 22 LTS recommended".

### 6.3 Rationale

The Dashboard uses Vite 7, whose dependency metadata requires `^20.19.0 || >=22.12.0`. Since Docker already runs Node 22, declaring Node 22 as the expected baseline avoids local/CI/Docker drift.

### 6.4 Verification

- `node -v` should satisfy `>=22.12.0`.
- `npm test` should still pass.
- `cd dashboard && npm run lint && npm run build` should still pass.

## 7. Phase 3: Clarify Documentation State

### 7.1 Target Files

Candidate completed plans moved from `docs/plans/` to `docs/done/`:

- `docs/done/2026-04-26-agent-runtime-v2-roadmap.md`
- `docs/done/2026-04-26-agent-qq-test-matrix.md`
- `docs/done/2026-04-27-agent-humanlike-participation-plan.md`

Review before moving:

- `docs/plans/2026-04-30-webui-modernization-design.md`

### 7.2 Intended Changes

- Move completed plan documents to `docs/done/`.
- Keep unfinished or still-active design documents in `docs/plans/`.
- Optionally add a short active maintenance roadmap after P0 is executed, covering:
  - release validation gate
  - Node version baseline
  - Dashboard bundle splitting
  - production security defaults

### 7.3 Verification

- `docs/plans/` should only contain active or not-yet-executed work.
- `docs/done/` should contain archived completion records.
- README references, if any, should still resolve after moving files.

## 8. Recommended Execution Order

1. Add release validation gate.
2. Align Node version declarations.
3. Clean up documentation state.

Reason: the CI release gate prevents unverified code from being published and should be handled before broader housekeeping.

## 9. Risks

- CI runtime may increase because tests, lint, and build run before every `main` release.
- Python dependency installation in GitHub Actions may expose dependency compatibility issues not seen locally.
- Moving documents may break links if README or other docs reference old paths.

## 10. Completion Criteria

This P0 adjustment is complete when:

- GitHub release workflow has a passing validation job before Docker image publishing.
- Node version expectation is consistent across README, package metadata, local `.nvmrc`, CI, and Docker.
- Completed plan documents are no longer mixed with active plans.
- Local verification commands still pass after changes.

## 11. Execution Progress

- Completed: added GitHub Actions `validate` job before Docker image publishing.
- Completed: aligned Node.js requirement to `>=22.12.0` in README, root package metadata, Dashboard package metadata, lockfiles, and `.nvmrc`.
- Completed: moved completed Agent planning documents from `docs/plans/` to `docs/done/` and updated references.
- Completed: local verification commands passed after implementation.
