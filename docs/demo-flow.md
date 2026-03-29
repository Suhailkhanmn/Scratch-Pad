# Demo Flow

This guide walks through the full `v0.1` loop from idea to local review handoff.

## Before You Start

- run the backend and frontend locally
- have a local project directory ready
- if you want to test review handoff, use a clean local git repo
- make sure your preferred adapter CLI is installed locally

## End-to-End Flow

### 1. Create a project

- open the app
- enter a project name
- optionally set the preferred adapter
- click `Create project`

Expected result:

- the project appears in the current project card
- reloading the page restores the same project

### 2. Save project setup

- add a local repo path
- save the preferred adapter if you did not set it earlier
- click `Save project setup`

Expected result:

- the repo path and adapter are saved as project metadata

### 3. Add scratch notes

- add a few short notes about the product idea
- keep them specific enough for a small v1

Good note examples:

- “Keep setup local first.”
- “No auth.”
- “Only one primary workflow.”
- “Start with a minimal desktop notification flow.”

### 4. Generate and review the PRD

- click `Generate PRD`
- review the `summary`, `scope`, `acceptance`, and `non-goals`
- optionally add a short revision instruction and click `Revise draft`
- click `Approve plan` when the scope is right

Expected result:

- the latest plan persists after reload
- approved plans unlock task generation

### 5. Generate the task queue

- click `Generate tasks`

Expected result:

- Scratch Pad creates a short ordered queue
- vague work may appear as `blocked`
- completed review handoffs later appear in `review`

### 6. Run the next task

- confirm the next task is `queued`
- click `Run next task`

Expected result:

- exactly one run starts
- the run appears in `Current run` and then in `Recent runs`
- a raw local log file is written under `apps/server/data/run-logs/`

### 7. Prepare review

After a run reaches `completed`:

- click `Prepare review`

Expected result:

- Scratch Pad creates a local branch named like `scratch/<task-id>-<slug>`
- the run stores changed files, diff stats, and a compact review summary
- the related task moves into `review`
- nothing is auto-committed, auto-pushed, or auto-merged

## Recommended Demo Repo

For the cleanest demo:

- use a small local repo
- keep the repo clean before starting the run
- avoid switching branches while a run is in progress

## Smoke Test Checklist

- The app loads and the server health endpoint returns `ok`.
- Adapter diagnostics load.
- A project can be created and survives reload.
- Notes can be added, edited, deleted, and reloaded.
- A PRD can be generated, revised, approved, and reloaded.
- Tasks can be generated from the approved plan.
- Blocked tasks are visually separated from queued tasks.
- `Run next task` starts exactly one run.
- A completed run appears in recent runs after reload.
- `Prepare review` creates a local `scratch/...` branch.
- The completed task moves to `review`.
- The review summary, changed files, and diff stats are visible in the UI.
- No push, PR creation, or merge happens automatically.

## Demo Notes

- If adapter auth is shown as `unknown`, the run may still work. Scratch Pad avoids pretending it can always verify local CLI auth.
- Planning and task generation are intentionally compact. If the notes are vague, the results may be rough and need human cleanup.
