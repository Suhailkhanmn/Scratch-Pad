import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PlanVersion } from "@scratch-pad/shared";

type PlanVersionRow = {
  id: string;
  project_id: string;
  summary: string;
  scope_json: string;
  acceptance_json: string;
  non_goals_json: string;
  approved: number;
  created_at: string;
};

export function createPlanVersion(
  database: DatabaseSync,
  input: {
    projectId: string;
    summary: string;
    scope: string[];
    acceptance: string[];
    nonGoals: string[];
    approved?: boolean;
  },
): PlanVersion {
  const plan: PlanVersion = {
    id: randomUUID(),
    projectId: input.projectId,
    summary: input.summary,
    scope: input.scope,
    acceptance: input.acceptance,
    nonGoals: input.nonGoals,
    approved: input.approved ?? false,
    createdAt: new Date().toISOString(),
  };

  database
    .prepare(
      `
        INSERT INTO plan_versions (
          id,
          project_id,
          summary,
          scope_json,
          acceptance_json,
          non_goals_json,
          approved,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      plan.id,
      plan.projectId,
      plan.summary,
      JSON.stringify(plan.scope),
      JSON.stringify(plan.acceptance),
      JSON.stringify(plan.nonGoals),
      plan.approved ? 1 : 0,
      plan.createdAt,
    );

  return plan;
}

export function getLatestPlanVersionByProjectId(
  database: DatabaseSync,
  projectId: string,
): PlanVersion | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          project_id,
          summary,
          scope_json,
          acceptance_json,
          non_goals_json,
          approved,
          created_at
        FROM plan_versions
        WHERE project_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
    )
    .get(projectId) as PlanVersionRow | undefined;

  return row ? mapPlanVersionRow(row) : null;
}

export function getLatestApprovedPlanVersionByProjectId(
  database: DatabaseSync,
  projectId: string,
): PlanVersion | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          project_id,
          summary,
          scope_json,
          acceptance_json,
          non_goals_json,
          approved,
          created_at
        FROM plan_versions
        WHERE project_id = ? AND approved = 1
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `,
    )
    .get(projectId) as PlanVersionRow | undefined;

  return row ? mapPlanVersionRow(row) : null;
}

export function approvePlanVersion(
  database: DatabaseSync,
  projectId: string,
  planVersionId: string,
): PlanVersion | null {
  const targetPlan = getPlanVersionById(database, planVersionId);

  if (!targetPlan || targetPlan.projectId !== projectId) {
    return null;
  }

  database.exec("BEGIN");

  try {
    database
      .prepare("UPDATE plan_versions SET approved = 0 WHERE project_id = ?")
      .run(projectId);

    database
      .prepare("UPDATE plan_versions SET approved = 1 WHERE id = ?")
      .run(planVersionId);

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return getPlanVersionById(database, planVersionId);
}

function getPlanVersionById(
  database: DatabaseSync,
  id: string,
): PlanVersion | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          project_id,
          summary,
          scope_json,
          acceptance_json,
          non_goals_json,
          approved,
          created_at
        FROM plan_versions
        WHERE id = ?
      `,
    )
    .get(id) as PlanVersionRow | undefined;

  return row ? mapPlanVersionRow(row) : null;
}

function mapPlanVersionRow(row: PlanVersionRow): PlanVersion {
  return {
    id: row.id,
    projectId: row.project_id,
    summary: row.summary,
    scope: JSON.parse(row.scope_json) as string[],
    acceptance: JSON.parse(row.acceptance_json) as string[],
    nonGoals: JSON.parse(row.non_goals_json) as string[],
    approved: Boolean(row.approved),
    createdAt: row.created_at,
  };
}
