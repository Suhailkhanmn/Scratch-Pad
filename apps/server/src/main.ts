import Fastify, { type FastifyError } from "fastify";
import {
  AdapterStatusListSchema,
  ApprovePrdInputSchema,
  CreateDirectoryInputSchema,
  CreateDirectoryResultSchema,
  CreateProjectInputSchema,
  CreateScratchNoteInputSchema,
  DirectoryBrowserQuerySchema,
  DirectoryBrowserResultSchema,
  DraftPrdInputSchema,
  HealthResponseSchema,
  OpenCodexAppResultSchema,
  OpenProjectRepoInputSchema,
  PlanMutationResultSchema,
  PrepareReviewResultSchema,
  ProductContextMutationResultSchema,
  ProductContextUpdateInputSchema,
  ProjectListSchema,
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
  TaskParamsSchema,
  TaskGenerationResultSchema,
  TaskListSchema,
  UpdateScratchNoteInputSchema,
} from "@scratch-pad/shared";
import { getAdapterStatuses, openRepoInCodexApp } from "./adapters.js";
import { createDatabaseContext } from "./db.js";
import { browseDirectories, createDirectory } from "./filesystem.js";
import {
  createScratchNote,
  deleteScratchNote,
  listScratchNotesByProjectId,
  updateScratchNote,
} from "./notes.js";
import {
  approveProjectPrd,
  draftProjectPrd,
  getProjectProductState,
  refreshProjectPrd,
  saveProjectProductContext,
  shapeProjectProductContext,
} from "./product-context-service.js";
import {
  createProject,
  deleteProject,
  getProjectById,
  listProjects,
  updateProjectSetup,
} from "./projects.js";
import { getProjectWorkspace } from "./project-workspace.js";
import { prepareReviewForRun } from "./review-handoff.js";
import { rerunTask, startNextTaskRun } from "./run-execution.js";
import {
  failInterruptedRuns,
  getActiveRun,
  getRunById,
  listRunsByProjectId,
} from "./runs.js";
import { buildGeneratedTasks } from "./task-planning.js";
import {
  getOpenTaskCountByPlanVersion,
  getTaskById,
  listTasksByProjectId,
  markOpenTasksMaybeStale,
  reconcileTasksWithPlan,
} from "./tasks.js";

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

server.get("/projects", async () =>
  ProjectListSchema.parse(listProjects(database)),
);

server.get("/filesystem/directories", async (request, reply) => {
  const parsedQuery = DirectoryBrowserQuerySchema.safeParse(request.query ?? {});

  if (!parsedQuery.success) {
    return reply.code(400).send({
      message: "Invalid directory browser query.",
      issues: parsedQuery.error.issues,
    });
  }

  try {
    return reply.send(
      DirectoryBrowserResultSchema.parse(
        browseDirectories(parsedQuery.data.path),
      ),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not browse directories.";

    return reply.code(400).send({ message });
  }
});

server.post("/filesystem/directories", async (request, reply) => {
  const parsedBody = CreateDirectoryInputSchema.safeParse(request.body);

  if (!parsedBody.success) {
    return reply.code(400).send({
      message: "Invalid create-folder payload.",
      issues: parsedBody.error.issues,
    });
  }

  try {
    return reply.code(201).send(
      CreateDirectoryResultSchema.parse(createDirectory(parsedBody.data)),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create the folder.";

    return reply.code(400).send({ message });
  }
});

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

server.delete("/projects/:id", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid project id.",
      issues: parsedParams.error.issues,
    });
  }

  const deleted = deleteProject(database, parsedParams.data.id);

  if (!deleted) {
    return reply.code(404).send({
      message: "Project not found.",
    });
  }

  return reply.code(204).send();
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
      getProjectProductState(database, project).plan,
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

server.post("/projects/:id/save-product-context", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);
  const parsedBody = ProductContextUpdateInputSchema.safeParse(request.body ?? {});

  if (!parsedParams.success || !parsedBody.success) {
    return reply.code(400).send({
      message: "Invalid product context payload.",
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

  try {
    const result = saveProjectProductContext(database, project, parsedBody.data);

    return reply.send(
      ProductContextMutationResultSchema.parse({
        productContext: result.productContext,
        message: result.message,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not save the repo-local product context.";

    return reply.code(400).send({ message });
  }
});

server.post("/projects/:id/shape-product", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);
  const parsedBody = ProductContextUpdateInputSchema.safeParse(request.body ?? {});

  if (!parsedParams.success || !parsedBody.success) {
    return reply.code(400).send({
      message: "Invalid product shaping payload.",
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

  const notes = listScratchNotesByProjectId(database, project.id);

  try {
    const result = await shapeProjectProductContext(
      database,
      project,
      notes,
      parsedBody.data,
    );

    return reply.send(
      ProductContextMutationResultSchema.parse({
        productContext: result.productContext,
        message: result.message,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not shape the repo-local product context.";

    return reply.code(400).send({ message });
  }
});

server.post("/projects/:id/generate-prd", async (request, reply) => {
  const parsedParams = ProjectParamsSchema.safeParse(request.params);
  const parsedBody = DraftPrdInputSchema.safeParse(request.body ?? {});

  if (!parsedParams.success || !parsedBody.success) {
    return reply.code(400).send({
      message: "Invalid PRD draft payload.",
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

  const notes = listScratchNotesByProjectId(database, parsedParams.data.id);

  try {
    const result = await draftProjectPrd(
      database,
      project,
      notes,
      parsedBody.data,
    );

    return reply.code(201).send(
      PlanMutationResultSchema.parse({
        plan: result.plan,
        message: result.message,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not draft the PRD.";

    return reply.code(400).send({ message });
  }
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

  const notes = listScratchNotesByProjectId(database, project.id);

  try {
    const result = await refreshProjectPrd(
      database,
      project,
      notes,
      parsedBody.data,
    );

    return reply.send(
      PlanMutationResultSchema.parse({
        plan: result.plan,
        message: result.message,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not refresh the PRD.";

    return reply.code(400).send({ message });
  }
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

  try {
    const result = approveProjectPrd(database, project);
    const activeRun = getActiveRun(database);
    const staleTaskCount = markOpenTasksMaybeStale(database, {
      projectId: project.id,
      latestPlanVersionId: result.approvedPlan.id,
      activeTaskId:
        activeRun?.projectId === project.id ? activeRun.taskId : null,
    });
    const message =
      staleTaskCount > 0
        ? `${result.message} Marked ${String(staleTaskCount)} open task(s) as maybe stale.`
        : result.message;

    return reply.send(
      PlanMutationResultSchema.parse({
        plan: result.approvedPlan,
        message,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not approve the PRD.";

    return reply.code(400).send({ message });
  }
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

  const { approvedPlan } = getProjectProductState(database, project);

  if (!approvedPlan) {
    return reply.code(400).send({
      message: "Approve the repo-local PRD before deriving code tasks.",
    });
  }

  const generated = buildGeneratedTasks(project, approvedPlan);
  const activeRun = getActiveRun(database);
  const taskResult = reconcileTasksWithPlan(database, {
    projectId: project.id,
    planVersionId: approvedPlan.id,
    tasks: generated.tasks,
    activeTaskId: activeRun?.projectId === project.id ? activeRun.taskId : null,
  });
  const alignedTaskCount = getOpenTaskCountByPlanVersion(
    database,
    project.id,
    approvedPlan.id,
  );
  const taskSummaryParts = [
    taskResult.createdCount > 0
      ? `created ${String(taskResult.createdCount)}`
      : null,
    taskResult.refreshedCount > 0
      ? `refreshed ${String(taskResult.refreshedCount)}`
      : null,
    taskResult.supersededCount > 0
      ? `flagged ${String(taskResult.supersededCount)} as superseded`
      : null,
  ].filter(Boolean);
  const message =
    taskSummaryParts.length > 0
      ? `Derived code tasks from approved PRD v${approvedPlan.versionNumber}: ${taskSummaryParts.join(", ")}. ${String(alignedTaskCount)} aligned open task(s) are ready.`
      : `Approved PRD v${approvedPlan.versionNumber} is already reflected in the current code queue.`;

  return reply.code(201).send(
    TaskGenerationResultSchema.parse({
      tasks: taskResult.tasks,
      message,
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

server.post("/tasks/:id/re-run", async (request, reply) => {
  const parsedParams = TaskParamsSchema.safeParse(request.params);

  if (!parsedParams.success) {
    return reply.code(400).send({
      message: "Invalid task id.",
      issues: parsedParams.error.issues,
    });
  }

  const task = getTaskById(database, parsedParams.data.id);

  if (!task) {
    return reply.code(404).send({
      message: "Task not found.",
    });
  }

  const project = getProjectById(database, task.projectId);

  if (!project) {
    return reply.code(404).send({
      message: "Project not found for this task.",
    });
  }

  try {
    const result = await rerunTask(database, project, task.id);

    return reply.code(201).send(
      RunNextTaskResultSchema.parse({
        run: result.run,
        task: result.task,
        message: result.message,
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not re-run this task.";

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
