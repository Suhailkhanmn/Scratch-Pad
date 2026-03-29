import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import type { WriteStream } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type { AdapterId, Project, RunStatus, Task } from "@scratch-pad/shared";
import {
  getAdapterStatusById,
  resolveInstalledAdapterCommand,
} from "./adapters.js";
import { captureRunGitContext } from "./git-review.js";
import {
  createRun,
  getActiveRun,
  getLatestRunByTaskId,
  updateRunStatus,
} from "./runs.js";
import {
  getTaskById,
  listTasksByProjectId,
  updateTaskStatus,
} from "./tasks.js";

const execFileAsync = promisify(execFile);
const RUN_LOG_DIRECTORY = resolve(process.cwd(), "data/run-logs");
const activeRunProcesses = new Map<string, ChildProcessWithoutNullStreams>();
const HELP_TIMEOUT_MS = 1_500;
const HELP_MAX_BUFFER_BYTES = 64 * 1024;

export async function startNextTaskRun(
  database: DatabaseSync,
  project: Project,
): Promise<{
  run: ReturnType<typeof createRun>;
  task: Task;
  message: string;
}> {
  const taskSelection = selectNextRunnableTask(database, project.id);

  if (!taskSelection.task) {
    throw new Error(taskSelection.message);
  }

  return startTaskRun(database, project, taskSelection.task);
}

export async function rerunTask(
  database: DatabaseSync,
  project: Project,
  taskId: string,
): Promise<{
  run: ReturnType<typeof createRun>;
  task: Task;
  message: string;
}> {
  const task = getTaskById(database, taskId);

  if (!task || task.projectId !== project.id) {
    throw new Error("Task not found for this project.");
  }

  if (task.status === "blocked") {
    throw new Error(
      "This task is blocked and cannot be re-run until it is manually reviewed.",
    );
  }

  return startTaskRun(database, project, task);
}

async function startTaskRun(
  database: DatabaseSync,
  project: Project,
  task: Task,
): Promise<{
  run: ReturnType<typeof createRun>;
  task: Task;
  message: string;
}> {
  const existingActiveRun = getActiveRun(database);

  if (existingActiveRun) {
    throw new Error(
      `Another run is already active for "${existingActiveRun.taskTitle}". Wait for it to finish before starting a new one.`,
    );
  }

  if (!project.repoPath) {
    throw new Error("Save a local repo path before running a task.");
  }

  ensureRepoPathIsRunnable(project.repoPath);

  if (!project.preferredAdapter) {
    throw new Error("Select a preferred adapter before running a task.");
  }

  const prompt = buildExecutionPrompt(project, task);
  const invocation = await prepareAdapterInvocation(
    project.preferredAdapter,
    prompt,
  );

  mkdirSync(RUN_LOG_DIRECTORY, { recursive: true });
  const gitContext = await captureRunGitContext(project.repoPath);

  const run = createRun(database, {
    projectId: project.id,
    taskId: task.id,
    taskTitle: task.title,
    adapter: project.preferredAdapter,
    outputLogPath: resolve(RUN_LOG_DIRECTORY, `${Date.now()}-${task.id}.log`),
    gitBaseBranch: gitContext.gitBaseBranch,
    gitBaseCommit: gitContext.gitBaseCommit,
  });

  const logStream = createWriteStream(run.outputLogPath, { flags: "a" });

  writeRunHeader(logStream, {
    project,
    task,
    adapterId: project.preferredAdapter,
    command: invocation.command,
    args: invocation.args,
    note: invocation.note,
  });

  const child = spawn(invocation.command, invocation.args, {
    cwd: project.repoPath,
    env: process.env,
  });

  activeRunProcesses.set(run.id, child);
  child.stdout.on("data", (chunk) => {
    logStream.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    logStream.write(chunk);
  });

  let finalized = false;

  const finalizeRun = (status: RunStatus, message: string) => {
    if (finalized) {
      return;
    }

    finalized = true;
    activeRunProcesses.delete(run.id);
    logStream.write(`\n[run-status] ${message}\n`);
    logStream.end();
    updateRunStatus(database, {
      id: run.id,
      status,
    });

    if (status === "completed") {
      updateTaskStatus(database, {
        id: task.id,
        status: "review",
      });
    }
  };

  child.on("error", (error) => {
    logStream.write(`\n[run-error] ${error.message}\n`);
    finalizeRun("failed", "Run failed before the adapter process started.");
  });

  child.on("close", (code, signal) => {
    if (signal) {
      finalizeRun("failed", `Run exited with signal ${signal}.`);
      return;
    }

    if (code === 0) {
      finalizeRun("completed", "Run completed successfully.");
      return;
    }

    finalizeRun(
      "failed",
      `Run exited with a non-zero status code: ${String(code ?? "unknown")}.`,
    );
  });

  const runningRun = updateRunStatus(database, {
    id: run.id,
    status: "running",
  });

  return {
    run: runningRun ?? run,
    task,
    message: buildRunStartMessage(task, project.preferredAdapter, invocation.note),
  };
}

function selectNextRunnableTask(
  database: DatabaseSync,
  projectId: string,
): { task: Task | null; message: string } {
  const tasks = listTasksByProjectId(database, projectId);
  let hasPendingHighRiskTask = false;
  let hasPendingStaleTask = false;

  for (const task of tasks) {
    if (task.status !== "queued") {
      continue;
    }

    if (task.driftStatus !== "aligned") {
      hasPendingStaleTask = true;
      continue;
    }

    const latestRun = getLatestRunByTaskId(database, task.id);

    if (latestRun?.status === "completed") {
      continue;
    }

    if (task.riskLevel === "high") {
      hasPendingHighRiskTask = true;
      continue;
    }

    return {
      task,
      message: `Ready to run "${task.title}".`,
    };
  }

  if (hasPendingHighRiskTask) {
    return {
      task: null,
      message:
        "No runnable queued tasks remain. High-risk tasks need manual review before they can run.",
    };
  }

  if (hasPendingStaleTask) {
    return {
      task: null,
      message:
        "The approved PRD changed, so the remaining open tasks need to be refreshed before another code run starts.",
    };
  }

  return {
    task: null,
    message:
      "No runnable queued tasks remain. Completed tasks are skipped and blocked tasks stay blocked.",
  };
}

function ensureRepoPathIsRunnable(repoPath: string) {
  const pathStats = statSync(repoPath, { throwIfNoEntry: false });

  if (!pathStats) {
    throw new Error("The saved repo path no longer exists on disk.");
  }

  if (!pathStats.isDirectory()) {
    throw new Error("The saved repo path is not a directory.");
  }
}

async function prepareAdapterInvocation(
  adapterId: AdapterId,
  prompt: string,
): Promise<{
  command: string;
  args: string[];
  note: string | null;
}> {
  const adapterStatus = await getAdapterStatusById(adapterId);

  if (!adapterStatus.installed) {
    throw new Error(adapterStatus.message);
  }

  if (adapterStatus.authenticated === false) {
    throw new Error(adapterStatus.message);
  }

  const resolvedCommand = await resolveInstalledAdapterCommand(adapterId);

  if (!resolvedCommand) {
    throw new Error(`${adapterStatus.name} CLI could not be resolved in PATH.`);
  }

  if (adapterId === "codex") {
    return {
      command: resolvedCommand.command,
      args: [
        "exec",
        "--skip-git-repo-check",
        "--color",
        "never",
        "--full-auto",
        prompt,
      ],
      note:
        adapterStatus.authenticated === "unknown"
          ? `${adapterStatus.name} authentication is unknown on this machine, so this run may fail after launch.`
          : null,
    };
  }

  const helpText = await readCommandHelp(resolvedCommand.command);
  const printFlag = resolveClaudePrintFlag(helpText);

  if (!printFlag) {
    throw new Error(
      "Claude Code is installed, but this CLI version does not expose a supported non-interactive print mode for Phase 6.",
    );
  }

  const args: string[] = [];

  if (/--dangerously-skip-permissions\b/.test(helpText)) {
    args.push("--dangerously-skip-permissions");
  }

  if (/--output-format\b/.test(helpText)) {
    args.push("--output-format", "text");
  }

  args.push(printFlag, prompt);

  return {
    command: resolvedCommand.command,
    args,
    note:
      adapterStatus.authenticated === "unknown"
        ? `${adapterStatus.name} authentication could not be verified locally, so this run is being attempted in best-effort mode.`
        : null,
  };
}

async function readCommandHelp(command: string) {
  const { stdout, stderr } = await execFileAsync(command, ["--help"], {
    timeout: HELP_TIMEOUT_MS,
    maxBuffer: HELP_MAX_BUFFER_BYTES,
    env: process.env,
  });

  return `${stdout}\n${stderr}`;
}

function resolveClaudePrintFlag(helpText: string) {
  if (/--print\b/.test(helpText)) {
    return "--print";
  }

  if (/(^|\s)-p(?:\s|,)/m.test(helpText)) {
    return "-p";
  }

  return null;
}

function buildExecutionPrompt(project: Project, task: Task) {
  return [
    "You are completing exactly one approved Scratch Pad task in a local repository.",
    `Project: ${project.name}`,
    `Task title: ${task.title}`,
    `Task description: ${task.description}`,
    `Risk level: ${task.riskLevel}`,
    "",
    "Rules:",
    "- Do not spend time on a broad repository audit or multi-step plan unless the task truly requires it.",
    "- Make the smallest concrete change you can for this one task.",
    "- If the workspace is sparse or not initialized as git, treat that as acceptable and continue.",
    "- Work only on this single task and then stop.",
    "- Stay inside the local repository for this project.",
    "- Do not create git branches, pull requests, or queue orchestration.",
    "- Do not start later tasks from the queue.",
    "- Finish by summarizing what changed and what still needs human review.",
  ].join("\n");
}

function writeRunHeader(
  logStream: WriteStream,
  input: {
    project: Project;
    task: Task;
    adapterId: AdapterId;
    command: string;
    args: string[];
    note: string | null;
  },
) {
  logStream.write(`[run] Scratch Pad Phase 6 task execution\n`);
  logStream.write(`[project] ${input.project.name}\n`);
  logStream.write(`[task] ${input.task.title}\n`);
  logStream.write(`[adapter] ${input.adapterId}\n`);
  logStream.write(`[command] ${input.command} ${input.args.join(" ")}\n`);
  logStream.write(`[started] ${new Date().toISOString()}\n`);

  if (input.note) {
    logStream.write(`[note] ${input.note}\n`);
  }

  logStream.write(`\n`);
}

function buildRunStartMessage(
  task: Task,
  adapterId: AdapterId,
  note: string | null,
) {
  const adapterLabel = adapterId === "claude-code" ? "Claude Code" : "Codex";
  const noteSuffix = note ? ` ${note}` : "";

  return `Started a local ${adapterLabel} run for "${task.title}".${noteSuffix}`;
}
