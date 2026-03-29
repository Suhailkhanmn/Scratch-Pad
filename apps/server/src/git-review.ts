import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import type { RunDiffStats, Task } from "@scratch-pad/shared";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 3_000;
const MAX_BUFFER_BYTES = 256 * 1024;

type GitContext = {
  isGitRepo: boolean;
  branch: string | null;
  commit: string | null;
  detached: boolean;
  porcelain: string;
};

type GitStatusEntry = {
  code: string;
  path: string;
};

export async function captureRunGitContext(repoPath: string): Promise<{
  gitBaseBranch: string | null;
  gitBaseCommit: string | null;
}> {
  try {
    const context = await getGitContext(repoPath);

    if (
      !context.isGitRepo ||
      context.detached ||
      !context.branch ||
      !context.commit ||
      context.porcelain.trim().length > 0
    ) {
      return {
        gitBaseBranch: null,
        gitBaseCommit: null,
      };
    }

    return {
      gitBaseBranch: context.branch,
      gitBaseCommit: context.commit,
    };
  } catch {
    return {
      gitBaseBranch: null,
      gitBaseCommit: null,
    };
  }
}

export async function getGitContext(repoPath: string): Promise<GitContext> {
  const insideWorktree = await runGit(repoPath, [
    "rev-parse",
    "--is-inside-work-tree",
  ]);

  if (!insideWorktree.ok || insideWorktree.stdout.trim() !== "true") {
    return {
      isGitRepo: false,
      branch: null,
      commit: null,
      detached: false,
      porcelain: "",
    };
  }

  const branchResult = await runGit(repoPath, ["branch", "--show-current"]);
  const commitResult = await runGit(repoPath, ["rev-parse", "HEAD"]);
  const statusResult = await runGit(repoPath, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);

  const branch = cleanOutput(branchResult.stdout) || null;
  const commit = cleanOutput(commitResult.stdout) || null;

  return {
    isGitRepo: true,
    branch,
    commit,
    detached: branch === null,
    porcelain: statusResult.stdout,
  };
}

export async function ensureReviewBranch(repoPath: string, branchName: string) {
  const existingBranch = await runGit(repoPath, [
    "rev-parse",
    "--verify",
    `refs/heads/${branchName}`,
  ]);

  if (existingBranch.ok) {
    throw new Error(
      `Review branch "${branchName}" already exists locally. Choose a new handoff branch or clean it up first.`,
    );
  }

  const switched = await runGit(repoPath, ["switch", "-c", branchName]);

  if (!switched.ok) {
    throw new Error(
      firstLine(switched.stderr || switched.stdout) ??
        `Could not create review branch "${branchName}".`,
    );
  }
}

export function buildReviewBranchName(taskId: string, taskTitle: string) {
  const slug = taskTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `scratch/${taskId}-${slug || "task"}`;
}

export function parseGitStatusEntries(porcelain: string): GitStatusEntry[] {
  return porcelain
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const path = rawPath.includes(" -> ")
        ? rawPath.split(" -> ").at(-1) ?? rawPath
        : rawPath;

      return {
        code,
        path,
      };
    });
}

export async function buildReviewArtifact(repoPath: string, input: {
  task: Task;
  outputLogPath: string;
}) {
  const context = await getGitContext(repoPath);

  if (!context.isGitRepo) {
    throw new Error("The saved repo path is not a git repository.");
  }

  const statusEntries = parseGitStatusEntries(context.porcelain);

  if (statusEntries.length === 0) {
    throw new Error("No local changes were found to hand off for review.");
  }

  const changedFiles = [...new Set(statusEntries.map((entry) => entry.path))];
  const diffStats = await getDiffStats(repoPath, changedFiles.length);
  const reviewSummary = buildReviewSummary({
    task: input.task,
    statusEntries,
    changedFiles,
    diffStats,
    outputLogPath: input.outputLogPath,
  });

  return {
    changedFiles,
    diffStats,
    reviewSummary,
  };
}

async function getDiffStats(
  repoPath: string,
  changedFileCount: number,
): Promise<RunDiffStats> {
  const result = await runGit(repoPath, ["diff", "--shortstat", "--find-renames", "HEAD"]);
  const output = `${result.stdout}\n${result.stderr}`;
  const filesChanged = changedFileCount;
  const insertions = extractStatCount(output, /(\d+)\sinsertions?\(\+\)/);
  const deletions = extractStatCount(output, /(\d+)\sdeletions?\(-\)/);

  return {
    filesChanged,
    insertions,
    deletions,
  };
}

function buildReviewSummary(input: {
  task: Task;
  statusEntries: GitStatusEntry[];
  changedFiles: string[];
  diffStats: RunDiffStats;
  outputLogPath: string;
}) {
  const testCommands = extractTestCommands(input.outputLogPath);
  const reviewNotes = extractReviewNotes(input.outputLogPath);

  return [
    `Task: ${input.task.title}`,
    "",
    "What changed",
    ...buildChangeBullets(input.statusEntries),
    "",
    "Changed files",
    ...input.changedFiles.map((file) => `- ${file}`),
    "",
    "How to test",
    ...(testCommands.length > 0
      ? testCommands.map((command) => `- ${command}`)
      : [
          "- Inspect the changed files locally and run the project checks that fit this task.",
        ]),
    "",
    "Open questions / risks",
    ...(reviewNotes.length > 0
      ? reviewNotes.map((note) => `- ${note}`)
      : [
          "- Confirm the local changes match the intended task scope before committing or pushing.",
        ]),
    "",
    `Diff stats: ${input.diffStats.filesChanged} file(s) changed, ${input.diffStats.insertions} insertion(s), ${input.diffStats.deletions} deletion(s).`,
  ].join("\n");
}

function buildChangeBullets(statusEntries: GitStatusEntry[]) {
  const uniqueEntries = new Map<string, GitStatusEntry>();

  for (const entry of statusEntries) {
    if (!uniqueEntries.has(entry.path)) {
      uniqueEntries.set(entry.path, entry);
    }
  }

  return [...uniqueEntries.values()].map((entry) => {
    if (entry.code.includes("R")) {
      return `- Renamed ${entry.path}`;
    }

    if (entry.code.includes("D")) {
      return `- Removed ${entry.path}`;
    }

    if (entry.code.includes("A") || entry.code === "??") {
      return `- Added ${entry.path}`;
    }

    return `- Updated ${entry.path}`;
  });
}

function extractTestCommands(outputLogPath: string) {
  if (!existsSync(outputLogPath)) {
    return [];
  }

  const logContents = readFileSync(outputLogPath, "utf8");
  const commands = new Set<string>();
  const regex = /^exec\s+\/bin\/zsh -lc\s+['"]?(.+?)['"]?\s+in\s+/gm;

  for (const match of logContents.matchAll(regex)) {
    const command = match[1]?.trim();

    if (!command || !isLikelyTestCommand(command)) {
      continue;
    }

    commands.add(command);
  }

  return [...commands].slice(-4);
}

function extractReviewNotes(outputLogPath: string) {
  if (!existsSync(outputLogPath)) {
    return [];
  }

  const logContents = readFileSync(outputLogPath, "utf8");
  const notes = new Set<string>();
  const patterns = [
    /Human review still needed[^.\n]*[.\n]?/gi,
    /still needs human review[^.\n]*[.\n]?/gi,
    /Open questions?[^.\n]*[.\n]?/gi,
  ];

  for (const pattern of patterns) {
    for (const match of logContents.matchAll(pattern)) {
      const note = cleanOutput(match[0] ?? "");

      if (note) {
        notes.add(note);
      }
    }
  }

  return [...notes].slice(-3);
}

function isLikelyTestCommand(command: string) {
  return /\b(test|check|build|verify)\b|^\.\//i.test(command);
}

async function runGit(repoPath: string, args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: repoPath,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      env: process.env,
    });

    return {
      ok: true,
      stdout,
      stderr,
    };
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
    };

    return {
      ok: false,
      stdout: commandError.stdout ?? "",
      stderr: commandError.stderr ?? "",
    };
  }
}

function extractStatCount(value: string, pattern: RegExp) {
  const match = value.match(pattern);
  return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
}

function cleanOutput(output: string) {
  return output.trim().replace(/\s+/g, " ");
}

function firstLine(output: string) {
  const [line] = output.split(/\r?\n/).map((entry) => entry.trim());
  return line || null;
}
