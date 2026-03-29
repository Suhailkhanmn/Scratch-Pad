# Scratch Pad — Implementation Plan

## Build thesis

Scratch Pad is a **local-first open-source orchestrator** that sits on top of **Claude Code** and **Codex CLI**.

It is for solo builders who already have those tools and want a lightweight flow:

**rough note → PRD → approved tasks → one local agent run → reviewable output → next task**

It is **not**:
- a hosted AI product
- a token reseller
- a team PM platform
- a multi-agent enterprise system

---

## MVP scope

| Area | MVP | Not now |
|---|---|---|
| Product model | Public repo, local-first | Hosted SaaS |
| Adapters | Claude Code, Codex only | More coding agents |
| Execution | One active task at a time | Parallel multi-agent scheduling |
| Review | Draft PR summary + human review | Auto-merge |
| Storage | Local SQLite | Cloud sync |
| UX | Scratch, chat, plan, queue, current run | Full dashboards |

---

## Product flow

1. User selects a local repo
2. User writes rough notes
3. System generates a compact PRD
4. User approves scope
5. System generates a small task queue
6. User starts the build loop
7. System runs one task locally through Claude Code or Codex
8. System records output and prepares reviewable change context
9. System moves to the next task only if policy allows

---

## Product rules

- One active task at a time
- No build loop before PRD approval
- Human review before merge
- Keep operational detail mostly hidden
- Default to the lightest possible flow
- Local repo execution only in MVP

---

## Tech stack

- **Frontend:** React + Vite + Tailwind
- **Backend:** Node.js + Fastify
- **Storage:** SQLite
- **Execution:** local CLI adapters
- **Monorepo:** pnpm workspace
- **Process runner:** `execa` or `child_process`

---

## Repo structure

```text
scratch-pad/
  apps/
    web/
    server/
  packages/
    shared/
  docs/
  README.md
  package.json
  pnpm-workspace.yaml
```

Expanded version:

```text
scratch-pad/
  apps/
    web/
      src/
        app/
        pages/
        components/
        features/
          projects/
          scratch/
          planning/
          queue/
          runs/
          settings/
    server/
      src/
        main.ts
        routes/
        services/
          projects/
          scratch/
          planning/
          orchestrator/
          adapters/
          git/
          policy/
        db/
        lib/
        types/
  packages/
    shared/
      src/
        schemas/
        contracts/
        constants/
  docs/
    architecture.md
    adapters.md
    local-setup.md
```

---

## Core modules

### 1. Projects service
Responsible for:
- project creation
- repo path binding
- preferred adapter selection
- project status

### 2. Scratch service
Responsible for:
- raw note capture
- scratch note persistence
- note listing / deletion / update

### 3. Planning service
Responsible for:
- PRD generation from notes
- PRD revision
- PRD approval
- task generation from approved PRD

### 4. Adapter layer
Provides one common interface for:
- Claude Code
- Codex

### 5. Orchestrator
Responsible for:
- claiming next task
- ensuring only one active run in MVP
- invoking adapter
- tracking run lifecycle
- deciding whether to continue or stop

### 6. Git service
Responsible for:
- creating work branches
- capturing changed files
- generating commit / PR summary suggestions

### 7. Policy service
Responsible for:
- approval gates
- stop conditions
- sequential mode enforcement
- risky task handling

---

## Adapter contract

```ts
export interface AgentAdapter {
  checkInstalled(): Promise<AdapterCheck>;
  checkAuthenticated(): Promise<AdapterCheck>;
  generatePlan(input: GeneratePlanInput): Promise<PlanDraft>;
  generateTasks(input: GenerateTasksInput): Promise<TaskDraft[]>;
  runTask(input: RunTaskInput): Promise<RunStartResult>;
  cancelRun(runId: string): Promise<void>;
}
```

### Claude Code adapter
MVP path:
- CLI-first integration
- local working directory execution
- prompt-file based plan/task generation

Later:
- hooks integration
- Agent SDK integration for tighter control

### Codex adapter
MVP path:
- CLI-first integration
- local working directory execution
- prompt-file based plan/task generation

Later:
- richer automation surfaces
- CI / SDK integrations if useful

---

## Data model

### `projects`
- `id`
- `name`
- `repo_path`
- `preferred_adapter`
- `status`
- `created_at`
- `updated_at`

### `scratch_notes`
- `id`
- `project_id`
- `content`
- `created_at`
- `updated_at`

### `plan_versions`
- `id`
- `project_id`
- `summary`
- `scope_json`
- `acceptance_json`
- `non_goals_json`
- `approved`
- `created_at`

### `tasks`
- `id`
- `project_id`
- `plan_version_id`
- `title`
- `description`
- `status`
- `order_index`
- `risk_level`
- `adapter_hint`
- `created_at`

### `runs`
- `id`
- `task_id`
- `adapter`
- `status`
- `branch_name`
- `output_log_path`
- `started_at`
- `finished_at`

### Recommended statuses

#### Project status
- `idle`
- `planning`
- `ready`
- `running`
- `paused`
- `error`

#### Task status
- `draft`
- `queued`
- `running`
- `review`
- `done`
- `blocked`
- `failed`

#### Run status
- `starting`
- `streaming`
- `verifying`
- `completed`
- `failed`
- `cancelled`

---

## API plan

### Projects
- `POST /projects`
- `GET /projects/:id`
- `POST /projects/:id/open-repo`

### Scratch
- `POST /projects/:id/notes`
- `GET /projects/:id/notes`
- `PATCH /notes/:id`
- `DELETE /notes/:id`

### Planning
- `POST /projects/:id/generate-prd`
- `POST /projects/:id/revise-prd`
- `POST /projects/:id/approve-prd`
- `POST /projects/:id/generate-tasks`

### Build loop
- `POST /projects/:id/start-loop`
- `POST /projects/:id/pause-loop`
- `POST /projects/:id/run-next-task`
- `GET /projects/:id/runs`
- `GET /runs/:id`

### Adapters
- `GET /adapters/status`
- `POST /adapters/claude/validate`
- `POST /adapters/codex/validate`

---

## UI implementation order

### Screen 1 — Project setup
Must support:
- create project
- pick / paste repo path
- choose preferred adapter

### Screen 2 — Scratch
Must support:
- add rough notes
- view notes
- edit notes
- shape with agent

### Screen 3 — PRD review
Must support:
- summary
- scope
- acceptance
- non-goals
- approve / revise

### Screen 4 — Queue
Must support:
- next task
- queued tasks
- blocked tasks

### Screen 5 — Current run
Must support:
- active task
- current stage
- output log preview
- run status

### Screen 6 — Recent output
Must support:
- recent completed tasks
- branch names
- PR summary snippets

---

## Six-phase implementation plan

## Phase 1 — scaffold

### Goal
Get the monorepo running locally.

### Tasks
- initialize pnpm monorepo
- create `apps/web`
- create `apps/server`
- create `packages/shared`
- configure TypeScript base settings
- configure Fastify server
- configure Vite React app
- add Tailwind setup
- add SQLite client and migration tool
- add shared Zod schemas

### Exit condition
App boots locally and health route works.

---

## Phase 2 — project setup + scratch

### Goal
Make the first usable flow.

### Tasks
- create project model and migration
- build project creation endpoint
- build project creation form
- add repo path field / picker support
- create scratch notes model and migration
- build scratch notes CRUD endpoints
- build scratch notes UI
- persist notes to SQLite

### Exit condition
User can create a project, attach a repo path, and save scratch notes.

---

## Phase 3 — adapter foundation

### Goal
Detect Claude Code and Codex locally.

### Tasks
- define adapter interfaces in shared package
- implement `ClaudeCodeAdapter.checkInstalled()`
- implement `CodexAdapter.checkInstalled()`
- implement auth / readiness checks
- create `/adapters/status` endpoint
- create adapter diagnostics UI
- let user select preferred adapter

### Exit condition
App can clearly show whether Claude Code and Codex are installed and usable.

---

## Phase 4 — planning flow

### Goal
Turn notes into an approvable PRD.

### Tasks
- create `plan_versions` table
- implement `generate-prd` endpoint
- create prompt template for PRD generation
- invoke selected adapter in non-interactive mode
- persist PRD result
- build PRD review UI
- implement revise PRD action
- implement approve PRD action

### Exit condition
User can generate, review, revise, and approve a PRD.

---

## Phase 5 — task generation + queue

### Goal
Turn the approved plan into executable tasks.

### Tasks
- create `tasks` table
- implement `generate-tasks` endpoint
- create task-generation prompt template
- persist ordered tasks
- build queue UI
- enforce policy: no queue execution before approval
- mark ambiguous tasks as `blocked`

### Rules
- keep task count small in MVP
- prefer small, concrete tasks
- do not fake precision for vague work

### Exit condition
Approved PRD becomes a visible task queue.

---

## Phase 6 — run loop

### Goal
Run one task locally through the selected adapter.

### Tasks
- create `runs` table
- implement next-task claim logic
- enforce one active run only
- create work branch via git service
- invoke selected adapter in repo working directory
- capture stdout / stderr to log file
- update run lifecycle states
- build current run UI
- generate draft PR summary
- move completed task to `review`
- continue to next task only if allowed

### Stop conditions
- plan not approved
- active run failed
- task marked risky or blocked
- adapter unavailable
- user paused loop

### Exit condition
A task can run locally and produce reviewable output.

---

## Policies for MVP

- One active task only
- No execution before PRD approval
- No auto-merge
- Stop on failed run
- Stop on ambiguous task
- Local-only repo execution
- Human review remains explicit

---

## Prompt strategy

Store prompts in repo, not inline in code.

Suggested layout:

```text
apps/server/src/prompts/
  prd.md
  revise-prd.md
  tasks.md
  run-task.md
  pr-summary.md
```

Why:
- easier iteration
- easier diffing
- easier debugging
- easier community contribution

---

## Two-week execution plan

| Day range | Outcome |
|---|---|
| 1–2 | monorepo scaffold, server shell, web shell, SQLite |
| 3–4 | project setup + scratch notes CRUD |
| 5–6 | adapter detection + diagnostics |
| 7–8 | PRD generation flow |
| 9–10 | task generation + queue |
| 11–12 | single-task run loop |
| 13–14 | git branch + PR summary + cleanup |

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| CLI behavior differs across machines | keep adapter layer thin, add strong diagnostics |
| Auth checks are flaky | expose `ready / not ready / unknown`, avoid fake certainty |
| Plan/task prompts drift | version prompts in repo |
| Run output is messy | store raw logs first, structure later |
| Users expect too much automation | make approval and stop conditions explicit |

---

## First exact coding slice

Start in this order:

1. scaffold monorepo
2. add SQLite + migrations
3. build project creation + repo path form
4. build scratch notes CRUD
5. add `/adapters/status`
6. implement Claude detect/auth check
7. implement Codex detect/auth check
8. build adapter status screen
9. add `generate-prd` endpoint with stubbed response
10. wire PRD review UI

This gets the shell real without overcommitting early.

---

## Success test

A user should be able to:

1. clone the repo
2. run the app locally
3. connect Claude Code or Codex locally
4. write rough notes
5. generate a PRD
6. approve it
7. generate tasks
8. run one task at a time locally
9. review the output

If that works end to end, the MVP is real.
