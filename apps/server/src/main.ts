import Fastify, { type FastifyError } from "fastify";
import {
  AdapterStatusListSchema,
  ApprovePrdInputSchema,
  CreateProjectInputSchema,
  CreateScratchNoteInputSchema,
  HealthResponseSchema,
  OpenCodexAppResultSchema,
  OpenProjectRepoInputSchema,
  PlanMutationResultSchema,
  PrepareReviewResultSchema,
  ProjectParamsSchema,
  ProjectPlanSchema,
  ProjectWorkspaceSchema,
  RevisePrdInputSchema,
  RunListSchema,
  RunNextTaskResultSchema,
  RunParamsSchema,
  RunSchema,
  ScratchNoteListSchema,
  ScratchNoteParamsSchema,
  TaskGenerationResultSchema,
  TaskListSchema,
  UpdateScratchNoteInputSchema,
} from "@scratch-pad/shared";
import { getAdapterStatuses, openRepoInCodexApp } from "./adapters.js";
import { createDatabaseContext } from "./db.js";
import {
  createScratchNote,
  deleteScratchNote,
  listScratchNotesByProjectId,
  updateScratchNote,
} from "./notes.js";
import { buildGeneratedPlan, buildRevisedPlan } from "./planning.js";
import {
  approvePlanVersion,
  createPlanVersion,
  getLatestApprovedPlanVersionByProjectId,
  getLatestPlanVersionByProjectId,
} from "./plans.js";
import { createProject, getProjectById, updateProjectSetup } from "./projects.js";
import { getProjectWorkspace } from "./project-workspace.js";
import { prepareReviewForRun } from "./review-handoff.js";
import { startNextTaskRun } from "./run-execution.js";
import {
  failInterruptedRuns,
  getRunById,
  listRunsByProjectId,
} from "./runs.js";
import { buildGeneratedTasks } from "./task-planning.js";
import { listTasksByProjectId, replaceProjectTasks } from "./tasks.js";

const server = Fastify({
  logger: true,
});

server.setErrorHandler((error: FastifyError, _request, reply) => {
  server.log.error(error);

  if (error.code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
    return reply.code(400).send({
      message: "Request body was empty. Try the action again or refresh the page.",
    });
  }

  if (error.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
    return reply.code(400).send({
      message: "Request body was not valid JSON.",
    });
  }

  if (error.statusCode && error.statusCode < 500) {
    return reply.code(error.statusCode).send({
      message: error.message,
    });
  }

  return reply.code(500).send({
    message: "Unexpected server error. Check the server terminal for details.",
  });
});

const { database, databasePath } = createDatabaseContext();
const interruptedRunCount = failInterruptedRuns(database);

if (interruptedRunCount > 0) {
  server.log.warn(
    { interruptedRunCount },
    "Marked interrupted runs as failed during startup recovery.",
  );
}

function buildHealthResponse() {
  const sqliteVersionRow = database
    .prepare("SELECT sqlite_version() AS version")
    .get() as { version: string };

  return HealthResponseSchema.parse({
    name: "scratch-pad-server",
    status: "ok",
    timestamp: new Date().toISOString(),
    database: {
      path: databasePath,
      sqliteVersion: sqliteVersionRow.version,
    },
  });
}

server.get("/health", async () => buildHealthResponse());
server.get("/api/health", async () => buildHealthResponse());
server.get("/adapters/status", async () =>
  AdapterStatusListSchema.parse(await getAdapterStatuses()),
);

server.post("/projects", async (request, reply) => {
  const parsedBody = CreateProjectInputSchema.safeParse(request.body);

  if (!parsedBody.success) {
    return reply.code(400).send({
      message: "Invalid project payload.",
      issues: parsedBody.error.issues,
    });
  }

  const project = createProject(database, parsedBody.data);

  return reply.code(201).send(project);
});

server.get("/projects/:id", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid project id.",
      issues: parsedParams.error.issues,
    });
  }

  const project = getProjectById(database, parsedParams.data.id);

  if (!project) {
    return reply.code(404).send({
      message: "Project not found.",
    });
  }

  return reply.send(project);
});

server.get("/projects/:id/workspace", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid project id.",
      issues: parsedParams.error.issues,
    });
  }

  const workspace = getProjectWorkspace(database, parsedParams.data.id);

  if (!workspace) {
    return reply.code(404).send({
      message: "Project not found.",
    });
  }

  return reply.send(ProjectWorkspaceSchema.parse(workspace));
});

server.post("/projects/:id/open-repo", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);
  const parsedBody = OpenProjectRepoInputSchema.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    return reply.code(400).send({
      message: "Invalid project setup payload.",
      issues: [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues),
      ],
    });
  }

  try {
    const project = updateProjectSetup(
      database,
      parsedParams.data.id,
      parsedBody.data,
    );

    if (!project) {
      return reply.code(404).send({
        message: "Project not found.",
      });
    }

    return reply.send(project);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save repo path.";

    return reply.code(400).send({ message });
  }
});

server.post("/projects/:id/open-codex-app", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid project id.",
      issues: parsedParams.error.issues,
    });
  }

  const project = getProjectById(database, parsedParams.data.id);

  if (!project) {
    return reply.code(404).send({
      message: "Project not found.",
    });
  }

  try {
    const result = await openRepoInCodexApp(project.repoPath ?? "");
    return reply.send(OpenCodexAppResultSchema.parse(result));
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not hand off this repo to Codex Desktop.";

    return reply.code(400).send({ message });
  }
});

server.post("/projects/:id/notes", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);
  const parsedBody = CreateScratchNoteInputSchema.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    return reply.code(400).send({
      message: "Invalid note payload.",
      issues: [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues),
      ],
    });
  }

  const project = getProjectById(database, parsedParams.data.id);

  if (!project) {
    return reply.code(404).send({
      message: "Project not found.",
    });
  }

  const note = createScratchNote(
    database,
    parsedParams.data.id,
    parsedBody.data,
  );

  return reply.code(201).send(note);
});

server.get("/projects/:id/notes", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid project id.",
      issues: parsedParams.error.issues,
    });
  }

  const project = getProjectById(database, parsedParams.data.id);

  if (!project) {
    return reply.code(404).send({
      message: "Project not found.",
    });
  }

  const notes = listScratchNotesByProjectId(database, parsedParams.data.id);

  return reply.send(ScratchNoteListSchema.parse(notes));
});

server.get("/projects/:id/plan", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid project id.",
      issues: parsedParams.error.issues,
    });
  }

  const project = getProjectById(database, parsedParams.data.id);

  if (!project) {
    return reply.code(404).send({
      message: "Project not found.",
    });
  }

  return reply.send(
    ProjectPlanSchema.parse(
      getLatestPlanVersionByProjectId(database, parsedParams.data.id),
    ),
  );
});

server.get("/projects/:id/tasks", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid project id.",
      issues: parsedParams.error.issues,
    });
  }

  const project = getProjectById(database, parsedParams.data.id);

  if (!project) {
    return reply.code(404).send({
      message: "Project not found.",
    });
  }

  return reply.send(
    TaskListSchema.parse(listTasksByProjectId(database, parsedParams.data.id)),
  );
});

server.get("/projects/:id/runs", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid project id.",
      issues: parsedParams.error.issues,
    });
  }

  const project = getProjectById(database, parsedParams.data.id);

  if (!project) {
    return reply.code(404).send({
      message: "Project not found.",
    });
  }

  return reply.send(
    RunListSchema.parse(listRunsByProjectId(database, parsedParams.data.id)),
  );
});

server.get("/runs/:id", async (request, reply) => {
  const parsedParams = RunParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid run id.",
      issues: parsedParams.error.issues,
    });
  }

  const run = getRunById(database, parsedParams.data.id);

  if (!run) {
    return reply.code(404).send({
      message: "Run not found.",
    });
  }

  return reply.send(RunSchema.parse(run));
});

server.post("/projects/:id/generate-prd", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid project id.",
      issues: parsedParams.error.issues,
    });
  }

  const project = getProjectById(database, parsedParams.data.id);

  if (!project) {
    return reply.code(404).send({
      message: "Project not found.",
    });
  }

  const notes = listScratchNotesByProjectId(database, parsedParams.data.id);

  if (notes.length === 0) {
    return reply.code(400).send({
      message: "Add at least one scratch note before generating a PRD.",
    });
  }

  const generated = await buildGeneratedPlan(project, notes);
  const plan = createPlanVersion(database, {
    projectId: project.id,
    summary: generated.draft.summary,
    scope: generated.draft.scope,
    acceptance: generated.draft.acceptance,
    nonGoals: generated.draft.nonGoals,
  });

  return reply.code(201).send(
    PlanMutationResultSchema.parse({
      plan,
      message: generated.message,
    }),
  );
});

server.post("/projects/:id/revise-prd", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);
  const parsedBody = RevisePrdInputSchema.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    return reply.code(400).send({
      message: "Invalid revision payload.",
      issues: [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues),
      ],
    });
  }

  const project = getProjectById(database, parsedParams.data.id);

  if (!project) {
    return reply.code(404).send({
      message: "Project not found.",
    });
  }

  const currentPlan = getLatestPlanVersionByProjectId(database, project.id);

  if (!currentPlan) {
    return reply.code(404).send({
      message: "Generate a PRD before revising it.",
    });
  }

  const notes = listScratchNotesByProjectId(database, project.id);
  const revised = await buildRevisedPlan(
    project,
    notes,
    currentPlan,
    parsedBody.data.instruction,
  );
  const plan = createPlanVersion(database, {
    projectId: project.id,
    summary: revised.draft.summary,
    scope: revised.draft.scope,
    acceptance: revised.draft.acceptance,
    nonGoals: revised.draft.nonGoals,
  });

  return reply.send(
    PlanMutationResultSchema.parse({
      plan,
      message: revised.message,
    }),
  );
});

server.post("/projects/:id/approve-prd", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);
  const parsedBody = ApprovePrdInputSchema.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    return reply.code(400).send({
      message: "Invalid approval payload.",
      issues: [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues),
      ],
    });
  }

  const project = getProjectById(database, parsedParams.data.id);

  if (!project) {
    return reply.code(404).send({
      message: "Project not found.",
    });
  }

  const approvedPlan = approvePlanVersion(
    database,
    project.id,
    parsedBody.data.planVersionId,
  );

  if (!approvedPlan) {
    return reply.code(404).send({
      message: "Plan version not found for this project.",
    });
  }

  return reply.send(
    PlanMutationResultSchema.parse({
      plan: approvedPlan,
      message: "Plan approved and saved.",
    }),
  );
});

server.post("/projects/:id/generate-tasks", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid project id.",
      issues: parsedParams.error.issues,
    });
  }

  const project = getProjectById(database, parsedParams.data.id);

  if (!project) {
    return reply.code(404).send({
      message: "Project not found.",
    });
  }

  const approvedPlan = getLatestApprovedPlanVersionByProjectId(
    database,
    project.id,
  );

  if (!approvedPlan) {
    return reply.code(400).send({
      message: "Approve a PRD before generating tasks.",
    });
  }

  const generated = buildGeneratedTasks(project, approvedPlan);
  const tasks = replaceProjectTasks(database, {
    projectId: project.id,
    planVersionId: approvedPlan.id,
    tasks: generated.tasks,
  });

  return reply.code(201).send(
    TaskGenerationResultSchema.parse({
      tasks,
      message: generated.message,
    }),
  );
});

server.post("/projects/:id/run-next-task", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid project id.",
      issues: parsedParams.error.issues,
    });
  }

  const project = getProjectById(database, parsedParams.data.id);

  if (!project) {
    return reply.code(404).send({
      message: "Project not found.",
    });
  }

  try {
    const result = await startNextTaskRun(database, project);

    return reply.code(201).send(
      RunNextTaskResultSchema.parse({
        run: result.run,
        task: result.task,
        message: result.message,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not start the next task.";

    return reply.code(400).send({ message });
  }
});

server.post("/runs/:id/prepare-review", async (request, reply) => {
  const parsedParams = RunParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid run id.",
      issues: parsedParams.error.issues,
    });
  }

  const run = getRunById(database, parsedParams.data.id);

  if (!run) {
    return reply.code(404).send({
      message: "Run not found.",
    });
  }

  const project = getProjectById(database, run.projectId);

  if (!project) {
    return reply.code(404).send({
      message: "Project not found for this run.",
    });
  }

  try {
    const result = await prepareReviewForRun(database, {
      runId: run.id,
      project,
    });

    return reply.send(
      PrepareReviewResultSchema.parse({
        run: result.run,
        task: result.task,
        message: result.message,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not prepare review for this run.";

    return reply.code(400).send({ message });
  }
});

server.patch("/notes/:id", async (request, reply) => {
  const parsedParams = ScratchNoteParamsSchema.safeParse(request.params);
  const parsedBody = UpdateScratchNoteInputSchema.safeParse(request.body);

  if (!parsedParams.success || !parsedBody.success) {
    return reply.code(400).send({
      message: "Invalid note payload.",
      issues: [
        ...(parsedParams.success ? [] : parsedParams.error.issues),
        ...(parsedBody.success ? [] : parsedBody.error.issues),
      ],
    });
  }

  const note = updateScratchNote(
    database,
    parsedParams.data.id,
    parsedBody.data,
  );

  if (!note) {
    return reply.code(404).send({
      message: "Note not found.",
    });
  }

  return reply.send(note);
});

server.delete("/notes/:id", async (request, reply) => {
  const parsedParams = ScratchNoteParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid note id.",
      issues: parsedParams.error.issues,
    });
  }

  const deleted = deleteScratchNote(database, parsedParams.data.id);

  if (!deleted) {
    return reply.code(404).send({
      message: "Note not found.",
    });
  }

  return reply.code(204).send();
});

async function start() {
  try {
    const port = Number(process.env.PORT ?? 3001);
    const host = process.env.HOST ?? "127.0.0.1";

    await server.listen({ port, host });
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

void start();
