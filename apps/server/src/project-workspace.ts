import type { DatabaseSync } from "node:sqlite";
import type {
  ProjectWorkspace,
  ProjectWorkspaceStage,
} from "@scratch-pad/shared";
import { listScratchNotesByProjectId } from "./notes.js";
import { getProjectProductState } from "./product-context-service.js";
import { getProjectById } from "./projects.js";
import { listRunsByProjectId } from "./runs.js";
import { listTasksByProjectId } from "./tasks.js";

export function getProjectWorkspace(
  database: DatabaseSync,
  projectId: string,
): ProjectWorkspace | null {
  const project = getProjectById(database, projectId);

  if (!project) {
    return null;
  }

  const notes = listScratchNotesByProjectId(database, projectId);
  const { productContext, plan, approvedPlan } = getProjectProductState(
    database,
    project,
  );
  const tasks = listTasksByProjectId(database, projectId);
  const runs = listRunsByProjectId(database, projectId);

  return {
    project,
    currentStage: getProjectWorkspaceStage({
      hasRepoPath: Boolean(project.repoPath),
      hasPreferredAdapter: Boolean(project.preferredAdapter),
      hasNotes: notes.length > 0,
      hasPlan: Boolean(plan),
      planApproved: plan?.approved ?? false,
      hasTasks: tasks.length > 0,
      hasRuns: runs.length > 0,
      hasReview: tasks.some(
        (task) =>
          task.status === "review" || task.status === "review_blocked",
      ),
    }),
    notes,
    productContext,
    plan,
    approvedPlan,
    tasks,
    runs,
  };
}

function getProjectWorkspaceStage(input: {
  hasRepoPath: boolean;
  hasPreferredAdapter: boolean;
  hasNotes: boolean;
  hasPlan: boolean;
  planApproved: boolean;
  hasTasks: boolean;
  hasRuns: boolean;
  hasReview: boolean;
}): ProjectWorkspaceStage {
  if (!input.hasRepoPath || !input.hasPreferredAdapter) {
    return "project";
  }

  if (!input.hasNotes) {
    return "scratch";
  }

  if (!input.hasPlan || !input.planApproved) {
    return "plan";
  }

  if (input.hasReview) {
    return "review";
  }

  if (input.hasRuns) {
    return "run";
  }

  if (input.hasTasks) {
    return "queue";
  }

  return "queue";
}
