# Scratch Pad OSS MVP

## What it is

Scratch Pad is a local-first open-source app for solo builders who already use **Claude Code** or **Codex**.

It helps them:
- dump rough ideas
- shape them into a compact PRD
- approve scope
- split into small tasks
- run tasks one by one locally using their own AI subscriptions

It is **not** a hosted AI service.
It is **not** a team PM tool.
It does **not** sell tokens.

---

## Core promise

**Idea → Plan → Queue → Build**

The product should feel like a notes app that turns into an execution loop.

---

## MVP boundaries

### Included
- public repo
- local-first app
- Claude Code integration
- Codex integration
- user brings own local auth/subscription
- local repo execution
- sequential task execution
- draft PR / human review flow

### Excluded
- cloud backend
- billing
- collaboration
- multi-user workspaces
- parallel agents
- auto-merge
- support for more tools

---

## Primary UX

### 1. Scratch
User drops rough thoughts with no structure.

### 2. Agent
System helps shape those notes into a compact v1 plan.

### 3. Plan
User reviews PRD with:
- scope
- acceptance
- non-goals

### 4. Queue
Approved plan becomes a small task list.

### 5. Build
System runs one task at a time through Claude Code or Codex and shows:
- current run
- next task
- recent output

---

## Product rules

- one active task at a time
- no build loop before plan approval
- human review before merge
- keep operational detail mostly hidden
- default to the lightest possible flow

---

## Stack

- **Frontend:** React + Vite + Tailwind
- **Backend:** Node + Fastify
- **Storage:** SQLite
- **Execution:** local CLI adapters

---

## Backend modules

### Scratch service
Stores projects, notes, plans, tasks, and runs.

### Planning service
Turns notes into PRD, then PRD into tasks.

### Adapter layer
Common interface for:
- Claude Code
- Codex

### Orchestrator
Runs the loop:
- claim next task
- invoke adapter
- track state
- stop or continue

### Git service
Creates work branches and prepares PR summaries.

---

## Adapter contract

Each adapter should support:
- `checkInstalled()`
- `checkAuthenticated()`
- `generatePlan()`
- `generateTasks()`
- `runTask()`
- `cancelRun()`

MVP implementation:
- Claude Code: CLI first
- Codex: CLI first

---

## Execution loop

1. select local repo
2. add scratch notes
3. generate PRD
4. approve PRD
5. generate tasks
6. start build loop
7. run next task locally
8. record output
9. prepare draft PR summary
10. continue if allowed

### Stop if
- plan not approved
- run fails
- user pauses
- task needs review
- adapter unavailable

---

## Minimal data model

### project
- id
- name
- repo_path
- preferred_adapter
- status

### scratch_note
- id
- project_id
- content

### plan_version
- id
- project_id
- summary
- scope_json
- acceptance_json
- non_goals_json
- approved

### task
- id
- project_id
- plan_version_id
- title
- description
- status
- order_index
- risk_level

### run
- id
- task_id
- adapter
- status
- branch_name
- output_log_path

---

## Repo shape

```text
scratch-pad/
  apps/
    web/
    server/
  packages/
    shared/
  docs/
  README.md
```

---

## First API slice

- `POST /projects`
- `POST /projects/:id/notes`
- `POST /projects/:id/generate-prd`
- `POST /projects/:id/approve-prd`
- `POST /projects/:id/generate-tasks`
- `POST /projects/:id/start-loop`
- `POST /projects/:id/run-next-task`
- `GET /adapters/status`

---

## Build order

### Phase 1
Scaffold monorepo, web shell, server shell, SQLite.

### Phase 2
Project selection, scratch notes, adapter detection.

### Phase 3
PRD generation and storage.

### Phase 4
Task generation and queue UI.

### Phase 5
Single-task orchestration.

### Phase 6
Git branch + draft PR summary.

---

## Success test

A user should be able to:
1. clone the repo
2. connect Claude Code or Codex locally
3. write rough notes
4. generate a PRD
5. approve it
6. generate tasks
7. run one task at a time locally
8. review the output

If that works, the MVP is real.

