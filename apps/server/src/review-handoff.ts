import type { DatabaseSync } from "node:sqlite";
import type { Project, Run, Task } from "@scratch-pad/shared";
import {
  buildReviewArtifact,
  buildReviewBranchName,
  ensureReviewBranch,
  getGitContext,
} from "./git-review.js";
import { getRunById, updateRunReviewArtifact } from "./runs.js";
import { getTaskById, updateTaskStatus } from "./tasks.js";

export async function prepareReviewForRun(
  database: DatabaseSync,
  input: {
    runId: string;
    project: Project;
  },
): Promise<{ run: Run; task: Task; message: string }> {
  const run = getRunById(database, input.runId);

  if (!run) {
    throw new Error("Run not found.");
  }

  const task = getTaskById(database, run.taskId);

  if (!task) {
    throw new Error(
      "The task for this run is no longer available. Review handoff works only while the original task still exists.",
    );
  }

  if (run.reviewPreparedAt && run.reviewBranchName) {
    return {
      run,
      task,
      message: `Review handoff is already prepared on branch "${run.reviewBranchName}".`,
    };
  }

  if (run.status !== "completed") {
    throw new Error("Only completed runs can be prepared for review.");
  }

  if (!input.project.repoPath) {
    throw new Error("The project does not have a saved local repo path.");
  }

  if (!run.gitBaseBranch || !run.gitBaseCommit) {
    throw new Error(
      "This run did not start from a clean local git branch, so review handoff cannot be prepared safely.",
    );
  }

  const gitContext = await getGitContext(input.project.repoPath);

  if (!gitContext.isGitRepo) {
    throw new Error("The saved repo path is not a git repository.");
  }

  if (gitContext.detached || !gitContext.branch) {
    throw new Error(
      "Review handoff requires the repository to still be on a named local branch.",
    );
  }

  if (gitContext.branch !== run.gitBaseBranch) {
    throw new Error(
      `Review handoff must start from the original branch "${run.gitBaseBranch}", but the repo is currently on "${gitContext.branch}".`,
    );
  }

  if (gitContext.commit !== run.gitBaseCommit) {
    throw new Error(
      "The base commit changed after the run started, so Scratch Pad cannot safely prepare a review branch.",
    );
  }

  const artifact = await buildReviewArtifact(input.project.repoPath, {
    task,
    outputLogPath: run.outputLogPath,
  });
  const branchName = buildReviewBranchName(task.id, task.title);
  await ensureReviewBranch(input.project.repoPath, branchName);

  const updatedRun = updateRunReviewArtifact(database, {
    id: run.id,
    reviewBranchName: branchName,
    reviewChangedFiles: artifact.changedFiles,
    reviewDiffStats: artifact.diffStats,
    reviewSummary: artifact.reviewSummary,
  });
  const updatedTask = updateTaskStatus(database, {
    id: task.id,
    status: "review",
  });

  if (!updatedRun || !updatedTask) {
    throw new Error("Could not persist the review handoff state.");
  }

  return {
    run: updatedRun,
    task: updatedTask,
    message: `Review handoff prepared on branch "${branchName}".`,
  };
}
