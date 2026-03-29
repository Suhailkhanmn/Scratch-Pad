# Local Setup

This guide gets Scratch Pad running on one machine with local storage only.

## Prerequisites

- a recent Node.js version with built-in `node:sqlite` support
- `pnpm` via Corepack or a local installation
- at least one supported local adapter CLI if you want to run tasks
  - `codex`
  - `claude` or `claude-code`
- a local git repository if you want to test review handoff

## Install

From the repo root:

```bash
corepack enable
pnpm install
```

## Run

Start the backend:

```bash
pnpm dev:server
```

Start the frontend in a second terminal:

```bash
pnpm dev:web
```

Open:

- web app: `http://127.0.0.1:5173`
- health endpoint: `http://127.0.0.1:3001/health`

## Local Data Paths

- database: `apps/server/data/scratch-pad.db`
- run logs: `apps/server/data/run-logs/`

Scratch Pad stores the currently selected project id in browser local storage under `scratch-pad/current-project-id`.

## First-Time Sanity Checks

Run these from the repo root:

```bash
pnpm typecheck
pnpm build:web
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/adapters/status
```

What to look for:

- the server reports `status: "ok"`
- the adapter endpoint returns Claude Code and Codex entries
- the web app loads without a blank screen

## Resetting Local State

Stop the server, then remove local data if you want a clean reset:

```bash
rm -rf apps/server/data
```

Also clear the browser key `scratch-pad/current-project-id` if you want the app to forget the last selected project.

## Troubleshooting

### The server will not start

- check whether port `3001` is already in use
- make sure your Node.js version supports `node:sqlite`

### The web app loads but actions fail

- confirm the backend is still running on `127.0.0.1:3001`
- check the server terminal for the request error
- hit `GET /health` directly to confirm the backend is alive

### Adapter diagnostics show not ready

- make sure the CLI is installed and available in `PATH`
- make sure the local CLI login is complete outside Scratch Pad
- if auth cannot be detected reliably, Scratch Pad may show `unknown`

### Saving a repo path fails

- the path must already exist on disk
- the path must point to a directory, not a file

### Run next task fails

- the project must have a saved repo path
- the project must have a preferred adapter
- there must be at least one eligible `queued` task
- blocked tasks and high-risk tasks are intentionally skipped

### Prepare review fails

- the run must be `completed`
- the repo must still be on the same named branch and base commit the run started from
- the repo must still be a git repo
- Scratch Pad does not prepare review from a dirty or detached baseline
