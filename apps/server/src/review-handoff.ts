import type { DatabaseSync } from "node:sqlite";
import type { Project, Run, Task } from "@scratch-pad/shared";
import {
  buildReviewArtifact,
  buildReviewBranchName,
  ensureReviewBranch,
  getGitContext,
} from "./git-review.js";
import {
  getRunById,
  updateRunReviewArtifact,
  updateRunReviewStatus,
} from "./runs.js";
import { getTaskById, updateTaskStatus } from "./tasks.js";

class ReviewPreparationError extends Error {
  reviewStatus: "blocked" | "failed";

  constructor(reviewStatus: "blocked" | "failed", message: string) {
    super(message);
    this.name = "ReviewPreparationError";
    this.reviewStatus = reviewStatus;
  }
}

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

  try {
    if (!input.project.repoPath) {
      throw new ReviewPreparationError(
        "blocked",
        "The project does not have a saved local repo path.",
      );
    }

    if (!run.gitBaseBranch || !run.gitBaseCommit) {
      throw new ReviewPreparationError(
        "blocked",
        "Review handoff failed because this run did not start from a clean named git branch.",
      );
    }

    const gitContext = await getGitContext(input.project.repoPath);

    if (!gitContext.isGitRepo) {
      throw new ReviewPreparationError(
        "blocked",
        "The saved repo path is not a git repository.",
      );
    }

    if (gitContext.detached || !gitContext.branch) {
      throw new ReviewPreparationError(
        "blocked",
        "Review handoff requires the repository to still be on a named local branch.",
      );
    }

    if (gitContext.branch !== run.gitBaseBranch) {
      throw new ReviewPreparationError(
        "blocked",
        `Review handoff must start from the original branch "${run.gitBaseBranch}", but the repo is currently on "${gitContext.branch}".`,
      );
    }

    if (gitContext.commit !== run.gitBaseCommit) {
      throw new ReviewPreparationError(
        "blocked",
        "The base commit changed after the run started, so Scratch Pad cannot safely prepare a review branch.",
      );
    }

    const artifact = await buildReviewArtifact(input.project.repoPath, {
      task,
      outputLogPath: run.outputLogPath,
    });
    const branchName = buildReviewBranchName(task.id, task.title);

    try {
      await ensureReviewBranch(input.project.repoPath, branchName);
    } catch (error) {
      throw normalizeReviewPreparationError(error);
    }

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
  } catch (error) {
    const normalizedError = normalizeReviewPreparationError(error);
    persistReviewIssue(database, {
      runId: run.id,
      taskId: task.id,
      reviewStatus: normalizedError.reviewStatus,
      reviewFailureReason: normalizedError.message,
    });
    throw normalizedError;
  }
}

function persistReviewIssue(
  database: DatabaseSync,
  input: {
    runId: string;
    taskId: string;
    reviewStatus: "blocked" | "failed";
    reviewFailureReason: string;
  },
) {
  const updatedRun = updateRunReviewStatus(database, {
    id: input.runId,
    reviewStatus: input.reviewStatus,
    reviewFailureReason: input.reviewFailureReason,
  });
  const updatedTask = updateTaskStatus(database, {
    id: input.taskId,
    status: "review_blocked",
  });

  if (!updatedRun || !updatedTask) {
    throw new Error("Could not persist the review handoff failure state.");
  }
}

function normalizeReviewPreparationError(error: unknown) {
  if (error instanceof ReviewPreparationError) {
    return error;
  }

  const message =
    error instanceof Error
      ? error.message
      : "Could not prepare review for this run.";

  if (isBlockedReviewErrorMessage(message)) {
    return new ReviewPreparationError("blocked", message);
  }

  return new ReviewPreparationError("failed", message);
}

function isBlockedReviewErrorMessage(message: string) {
  return (
    message === "The saved repo path is not a git repository." ||
    message === "No local changes were found to hand off for review." ||
    message ===
      "Review handoff requires the repository to still be on a named local branch." ||
    message.startsWith('Review branch "') ||
    message.startsWith('Review handoff must start from the original branch "')
  );
}
