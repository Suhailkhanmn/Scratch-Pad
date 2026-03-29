import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  AdapterId,
  Run,
  RunDiffStats,
  ReviewHandoffStatus,
  RunStatus,
} from "@scratch-pad/shared";

type RunRow = {
  id: string;
  project_id: string;
  task_id: string;
  task_title: string;
  adapter: AdapterId;
  status: RunStatus;
  output_log_path: string;
  git_base_branch: string | null;
  git_base_commit: string | null;
  review_status: ReviewHandoffStatus;
  review_failure_reason: string | null;
  review_branch_name: string | null;
  review_changed_files_json: string | null;
  review_diff_stats_json: string | null;
  review_summary: string | null;
  review_prepared_at: string | null;
  started_at: string;
  finished_at: string | null;
};

export function createRun(
  database: DatabaseSync,
  input: {
    projectId: string;
    taskId: string;
    taskTitle: string;
    adapter: AdapterId;
    outputLogPath: string;
    gitBaseBranch: string | null;
    gitBaseCommit: string | null;
  },
): Run {
  const run: Run = {
    id: randomUUID(),
    projectId: input.projectId,
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    adapter: input.adapter,
    status: "starting",
    outputLogPath: input.outputLogPath,
    gitBaseBranch: input.gitBaseBranch,
    gitBaseCommit: input.gitBaseCommit,
    reviewStatus: "not_started",
    reviewFailureReason: null,
    reviewBranchName: null,
    reviewChangedFiles: null,
    reviewDiffStats: null,
    reviewSummary: null,
    reviewPreparedAt: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  database
    .prepare(
      `
        INSERT INTO runs (
          id,
          project_id,
          task_id,
          task_title,
          adapter,
          status,
          output_log_path,
          git_base_branch,
          git_base_commit,
          review_status,
          review_failure_reason,
          review_branch_name,
          review_changed_files_json,
          review_diff_stats_json,
          review_summary,
          review_prepared_at,
          started_at,
          finished_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      run.id,
      run.projectId,
      run.taskId,
      run.taskTitle,
      run.adapter,
      run.status,
      run.outputLogPath,
      run.gitBaseBranch,
      run.gitBaseCommit,
      run.reviewStatus,
      run.reviewFailureReason,
      run.reviewBranchName,
      stringifyJson(run.reviewChangedFiles),
      stringifyJson(run.reviewDiffStats),
      run.reviewSummary,
      run.reviewPreparedAt,
      run.startedAt,
      run.finishedAt,
    );

  return run;
}

export function getRunById(database: DatabaseSync, id: string): Run | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          project_id,
          task_id,
          task_title,
          adapter,
          status,
          output_log_path,
          git_base_branch,
          git_base_commit,
          review_status,
          review_failure_reason,
          review_branch_name,
          review_changed_files_json,
          review_diff_stats_json,
          review_summary,
          review_prepared_at,
          started_at,
          finished_at
        FROM runs
        WHERE id = ?
      `,
    )
    .get(id) as RunRow | undefined;

  return row ? mapRunRow(row) : null;
}

export function listRunsByProjectId(
  database: DatabaseSync,
  projectId: string,
): Run[] {
  const rows = database
    .prepare(
      `
        SELECT
          id,
          project_id,
          task_id,
          task_title,
          adapter,
          status,
          output_log_path,
          git_base_branch,
          git_base_commit,
          review_status,
          review_failure_reason,
          review_branch_name,
          review_changed_files_json,
          review_diff_stats_json,
          review_summary,
          review_prepared_at,
          started_at,
          finished_at
        FROM runs
        WHERE project_id = ?
        ORDER BY started_at DESC, id DESC
      `,
    )
    .all(projectId) as RunRow[];

  return rows.map(mapRunRow);
}

export function getLatestRunByTaskId(
  database: DatabaseSync,
  taskId: string,
): Run | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          project_id,
          task_id,
          task_title,
          adapter,
          status,
          output_log_path,
          git_base_branch,
          git_base_commit,
          review_status,
          review_failure_reason,
          review_branch_name,
          review_changed_files_json,
          review_diff_stats_json,
          review_summary,
          review_prepared_at,
          started_at,
          finished_at
        FROM runs
        WHERE task_id = ?
        ORDER BY started_at DESC, id DESC
        LIMIT 1
      `,
    )
    .get(taskId) as RunRow | undefined;

  return row ? mapRunRow(row) : null;
}

export function getActiveRun(database: DatabaseSync): Run | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          project_id,
          task_id,
          task_title,
          adapter,
          status,
          output_log_path,
          git_base_branch,
          git_base_commit,
          review_status,
          review_failure_reason,
          review_branch_name,
          review_changed_files_json,
          review_diff_stats_json,
          review_summary,
          review_prepared_at,
          started_at,
          finished_at
        FROM runs
        WHERE status IN ('starting', 'running')
        ORDER BY started_at DESC, id DESC
        LIMIT 1
      `,
    )
    .get() as RunRow | undefined;

  return row ? mapRunRow(row) : null;
}

export function updateRunStatus(
  database: DatabaseSync,
  input: {
    id: string;
    status: RunStatus;
    finishedAt?: string | null;
  },
): Run | null {
  const existingRun = getRunById(database, input.id);

  if (!existingRun) {
    return null;
  }

  const nextFinishedAt =
    input.finishedAt !== undefined
      ? input.finishedAt
      : input.status === "starting" || input.status === "running"
        ? null
        : new Date().toISOString();

  database
    .prepare(
      `
        UPDATE runs
        SET status = ?, finished_at = ?
        WHERE id = ?
      `,
    )
    .run(input.status, nextFinishedAt, input.id);

  return getRunById(database, input.id);
}

export function updateRunReviewArtifact(
  database: DatabaseSync,
  input: {
    id: string;
    reviewBranchName: string;
    reviewChangedFiles: string[];
    reviewDiffStats: RunDiffStats;
    reviewSummary: string;
    reviewPreparedAt?: string;
  },
): Run | null {
  const existingRun = getRunById(database, input.id);

  if (!existingRun) {
    return null;
  }

  const reviewPreparedAt = input.reviewPreparedAt ?? new Date().toISOString();

  database
    .prepare(
      `
        UPDATE runs
        SET
          review_status = 'prepared',
          review_failure_reason = NULL,
          review_branch_name = ?,
          review_changed_files_json = ?,
          review_diff_stats_json = ?,
          review_summary = ?,
          review_prepared_at = ?
        WHERE id = ?
      `,
    )
    .run(
      input.reviewBranchName,
      stringifyJson(input.reviewChangedFiles),
      stringifyJson(input.reviewDiffStats),
      input.reviewSummary,
      reviewPreparedAt,
      input.id,
    );

  return getRunById(database, input.id);
}

export function updateRunReviewStatus(
  database: DatabaseSync,
  input: {
    id: string;
    reviewStatus: ReviewHandoffStatus;
    reviewFailureReason?: string | null;
  },
): Run | null {
  const existingRun = getRunById(database, input.id);

  if (!existingRun) {
    return null;
  }

  const nextReviewPreparedAt =
    input.reviewStatus === "prepared"
      ? existingRun.reviewPreparedAt ?? new Date().toISOString()
      : null;

  database
    .prepare(
      `
        UPDATE runs
        SET
          review_status = ?,
          review_failure_reason = ?,
          review_prepared_at = ?
        WHERE id = ?
      `,
    )
    .run(
      input.reviewStatus,
      input.reviewFailureReason ?? null,
      nextReviewPreparedAt,
      input.id,
    );

  return getRunById(database, input.id);
}

export function failInterruptedRuns(database: DatabaseSync): number {
  const interruptedRuns = database
    .prepare(
      `
        SELECT id
        FROM runs
        WHERE status IN ('starting', 'running')
      `,
    )
    .all() as Array<{ id: string }>;

  if (interruptedRuns.length === 0) {
    return 0;
  }

  const finishedAt = new Date().toISOString();

  database
    .prepare(
      `
        UPDATE runs
        SET status = 'failed', finished_at = ?
        WHERE status IN ('starting', 'running')
      `,
    )
    .run(finishedAt);

  return interruptedRuns.length;
}

function mapRunRow(row: RunRow): Run {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    adapter: row.adapter,
    status: row.status,
    outputLogPath: row.output_log_path,
    gitBaseBranch: row.git_base_branch,
    gitBaseCommit: row.git_base_commit,
    reviewStatus: row.review_status,
    reviewFailureReason: row.review_failure_reason,
    reviewBranchName: row.review_branch_name,
    reviewChangedFiles: parseJson<string[]>(row.review_changed_files_json),
    reviewDiffStats: parseJson<RunDiffStats>(row.review_diff_stats_json),
    reviewSummary: row.review_summary,
    reviewPreparedAt: row.review_prepared_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as T;
}

function stringifyJson(value: unknown) {
  return value === null ? null : JSON.stringify(value);
}
