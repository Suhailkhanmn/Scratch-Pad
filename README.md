# Scratch Pad

Scratch Pad is a local-first open-source app for solo builders who already use local coding agents like Claude Code or Codex.

It turns a rough idea into a compact local workflow:

1. capture scratch notes
2. generate a small PRD
3. approve scope
4. generate a short task queue
5. run one task locally
6. prepare a review handoff on a local git branch

Scratch Pad is intentionally narrow in `v0.1`.
It does not do hosted sync, collaboration, auto-push, auto-merge, or parallel runs.

## Current v0.1 Loop

- local projects with saved repo paths and preferred adapter metadata
- persisted scratch notes in SQLite
- compact PRD generation, revision, and approval
- small ordered task queues with `queued`, `blocked`, and `review` states
- one manual local run at a time through Claude Code or Codex
- optional Codex Desktop repo handoff through `codex app`
- persisted run history and raw local log files
- local git review handoff with a per-run branch, changed files, diff stats, and a short PR-ready summary

## Prerequisites

- a recent Node.js version with built-in `node:sqlite` support
- `codex` or `claude`/`claude-code` installed locally if you want Scratch Pad to run tasks
- a clean local git repository on a named branch if you want to use review handoff

## Quick Start

If `pnpm` is not installed already:

```bash
corepack enable
```

Install dependencies:

```bash
pnpm install
```

Run the backend:

```bash
pnpm dev:server
```

Run the frontend in a second terminal:

```bash
pnpm dev:web
```

Default local URLs:

- web: `http://127.0.0.1:5173`
- server: `http://127.0.0.1:3001`
- health: `http://127.0.0.1:3001/health`

Useful verification commands:

```bash
pnpm typecheck
pnpm build:web
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/adapters/status
```

## Docs

- local setup and troubleshooting: [docs/local-setup.md](/Users/suhailkhan/Documents/GitHub/Scratch%20Pad/docs/local-setup.md)
- end-to-end usage guide: [docs/demo-flow.md](/Users/suhailkhan/Documents/GitHub/Scratch%20Pad/docs/demo-flow.md)
- Codex Desktop support notes: [docs/codex-app-support.md](/Users/suhailkhan/Documents/GitHub/Scratch%20Pad/docs/codex-app-support.md)
- original implementation notes: [docs/scratch-pad-implementation-plan.md](/Users/suhailkhan/Documents/GitHub/Scratch%20Pad/docs/scratch-pad-implementation-plan.md)
- original MVP framing: [docs/scratch_pad_oss_mvp.md](/Users/suhailkhan/Documents/GitHub/Scratch%20Pad/docs/scratch_pad_oss_mvp.md)

## Smoke Test Checklist

- `pnpm install` completes successfully.
- `pnpm dev:server` starts and `GET /health` returns `ok`.
- `pnpm dev:web` loads the app locally.
- Creating a project works and the current project survives reload.
- Saving a repo path and preferred adapter works.
- Scratch notes can be added, edited, deleted, and reloaded.
- A PRD can be generated, revised, approved, and reloaded.
- Tasks can be generated only after plan approval.
- Blocked and high-risk tasks stay out of the runnable path.
- `Run next task` creates a persisted run with a local log file.
- `Prepare review` creates a local `scratch/<task-id>-<slug>` branch and moves the task to `review`.
- Nothing is auto-pushed, auto-merged, or sent to GitHub.

## Known Limitations

- Planning and task generation are still local heuristics, so rough notes can produce awkward titles or overly literal scope items.
- Only Claude Code and Codex are supported.
- Adapter authentication checks are intentionally lightweight and may return `unknown`.
- Only one task can run at a time, and queue advancement is always manual.
- Review handoff requires a clean local git repository on a named branch.
- Review handoff prepares branch context only. It does not commit, push, or open a PR.
- The UI shows log paths and summaries, not a full live terminal console.
- The browser remembers only one current project id locally.
- Data is local to this machine. There is no cloud sync, collaboration, or shared state.

## Local Data

- SQLite database: `apps/server/data/scratch-pad.db`
- run logs: `apps/server/data/run-logs/`

If you want a clean local reset, stop the server and remove `apps/server/data/`, then clear the browser entry for `scratch-pad/current-project-id`.

## Repo Layout

```text
scratch-pad/
  apps/
    server/
    web/
  docs/
  packages/
    shared/
  README.md
```

## Notes

- The standalone mock UI file remains in the repo as a reference artifact and is not wired into the runnable app.
- Scratch Pad currently optimizes for a clean local operator flow, not a full orchestration platform.
