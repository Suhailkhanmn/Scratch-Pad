import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PlanVersion } from "@scratch-pad/shared";
import {
  buildPrdMarkdown,
  hashMarkdown,
  PRODUCT_PRD_RELATIVE_PATH,
} from "./product-files.js";

type PlanVersionRow = {
  id: string;
  project_id: string;
  version_number: number | null;
  summary: string;
  scope_json: string;
  acceptance_json: string;
  non_goals_json: string;
  source_path: string | null;
  body_markdown: string | null;
  content_hash: string | null;
  approved: number;
  created_at: string;
};

export function createPlanVersion(
  database: DatabaseSync,
  input: {
    projectId: string;
    versionNumber?: number;
    summary: string;
    scope: string[];
    acceptance: string[];
    nonGoals: string[];
    sourcePath?: string;
    bodyMarkdown?: string;
    contentHash?: string;
    approved?: boolean;
  },
): PlanVersion {
  const bodyMarkdown =
    input.bodyMarkdown ??
    buildPrdMarkdown({
      summary: input.summary,
      scope: input.scope,
      acceptance: input.acceptance,
      nonGoals: input.nonGoals,
    });
  const sourcePath = input.sourcePath ?? PRODUCT_PRD_RELATIVE_PATH;
  const contentHash = input.contentHash ?? hashMarkdown(bodyMarkdown);
  const plan: PlanVersion = {
    id: randomUUID(),
    projectId: input.projectId,
    versionNumber:
      input.versionNumber ?? getNextPlanVersionNumber(database, input.projectId),
    summary: input.summary,
    scope: input.scope,
    acceptance: input.acceptance,
    nonGoals: input.nonGoals,
    sourcePath,
    bodyMarkdown,
    contentHash,
    approved: input.approved ?? false,
    createdAt: new Date().toISOString(),
  };

  database
    .prepare(
      `
        INSERT INTO plan_versions (
          id,
          project_id,
          version_number,
          summary,
          scope_json,
          acceptance_json,
          non_goals_json,
          source_path,
          body_markdown,
          content_hash,
          approved,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      plan.id,
      plan.projectId,
      plan.versionNumber,
      plan.summary,
      JSON.stringify(plan.scope),
      JSON.stringify(plan.acceptance),
      JSON.stringify(plan.nonGoals),
      plan.sourcePath,
      plan.bodyMarkdown,
      plan.contentHash,
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
          version_number,
          summary,
          scope_json,
          acceptance_json,
          non_goals_json,
          source_path,
          body_markdown,
          content_hash,
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
          version_number,
          summary,
          scope_json,
          acceptance_json,
          non_goals_json,
          source_path,
          body_markdown,
          content_hash,
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

export function getPlanVersionById(
  database: DatabaseSync,
  id: string,
): PlanVersion | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          project_id,
          version_number,
          summary,
          scope_json,
          acceptance_json,
          non_goals_json,
          source_path,
          body_markdown,
          content_hash,
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
  const summary = row.summary;
  const scope = JSON.parse(row.scope_json) as string[];
  const acceptance = JSON.parse(row.acceptance_json) as string[];
  const nonGoals = JSON.parse(row.non_goals_json) as string[];
  const fallbackBodyMarkdown = buildPrdMarkdown({
    summary,
    scope,
    acceptance,
    nonGoals,
  });
  const bodyMarkdown = hasStructuredPrdBody(row.body_markdown)
    ? row.body_markdown
    : fallbackBodyMarkdown;

  return {
    id: row.id,
    projectId: row.project_id,
    versionNumber: row.version_number ?? 1,
    summary,
    scope,
    acceptance,
    nonGoals,
    sourcePath: row.source_path ?? PRODUCT_PRD_RELATIVE_PATH,
    bodyMarkdown,
    contentHash:
      row.content_hash && hasStructuredPrdBody(row.body_markdown)
        ? row.content_hash
        : hashMarkdown(bodyMarkdown),
    approved: Boolean(row.approved),
    createdAt: row.created_at,
  };
}

function hasStructuredPrdBody(value: string | null): value is string {
  if (!value || value.trim().length === 0) {
    return false;
  }

  return /(^|\n)##\s+(Summary|Scope|Acceptance|Non-goals)/i.test(value);
}

function getNextPlanVersionNumber(
  database: DatabaseSync,
  projectId: string,
) {
  const row = database
    .prepare(
      `
        SELECT COALESCE(MAX(version_number), 0) AS max_version_number
        FROM plan_versions
        WHERE project_id = ?
      `,
    )
    .get(projectId) as { max_version_number: number | null };

  return (row.max_version_number ?? 0) + 1;
}
