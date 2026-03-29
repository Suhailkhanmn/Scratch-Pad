import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  PreferredAdapter,
  Task,
  TaskDriftStatus,
  TaskRiskLevel,
  TaskStatus,
} from "@scratch-pad/shared";

type TaskRow = {
  id: string;
  project_id: string;
  plan_version_id: string;
  task_key: string;
  title: string;
  description: string;
  status: TaskStatus;
  drift_status: TaskDriftStatus;
  order_index: number;
  risk_level: TaskRiskLevel;
  adapter_hint: PreferredAdapter;
  created_at: string;
};

type StoredTask = Task & {
  taskKey: string;
};

export type TaskDraft = {
  taskKey: string;
  title: string;
  description: string;
  status: Extract<TaskStatus, "queued" | "blocked">;
  riskLevel: TaskRiskLevel;
  adapterHint: PreferredAdapter;
};

export function reconcileTasksWithPlan(
  database: DatabaseSync,
  input: {
    projectId: string;
    planVersionId: string;
    tasks: TaskDraft[];
    activeTaskId?: string | null;
  },
): {
  tasks: Task[];
  createdCount: number;
  refreshedCount: number;
  supersededCount: number;
} {
  const existingTasks = listStoredTasksByProjectId(database, input.projectId);
  const activeTaskId = input.activeTaskId ?? null;
  const mutableOpenTasks = existingTasks.filter(
    (task) => isOpenTaskStatus(task.status) && task.id !== activeTaskId,
  );
  const closedTaskKeys = new Set(
    existingTasks
      .filter((task) => isClosedTaskStatus(task.status))
      .map((task) => task.taskKey),
  );
  const matchedTaskIds = new Set<string>();
  let createdCount = 0;
  let refreshedCount = 0;
  let supersededCount = 0;

  database.exec("BEGIN");

  try {
    input.tasks.forEach((taskDraft, index) => {
      const existingTask = mutableOpenTasks.find(
        (task) =>
          task.taskKey === taskDraft.taskKey && !matchedTaskIds.has(task.id),
      );

      if (existingTask) {
        matchedTaskIds.add(existingTask.id);

        const wasChanged =
          existingTask.planVersionId !== input.planVersionId ||
          existingTask.title !== taskDraft.title ||
          existingTask.description !== taskDraft.description ||
          existingTask.status !== taskDraft.status ||
          existingTask.riskLevel !== taskDraft.riskLevel ||
          existingTask.adapterHint !== taskDraft.adapterHint ||
          existingTask.driftStatus !== "aligned" ||
          existingTask.orderIndex !== index;

        database
          .prepare(
            `
              UPDATE tasks
              SET
                plan_version_id = ?,
                title = ?,
                description = ?,
                status = ?,
                drift_status = 'aligned',
                order_index = ?,
                risk_level = ?,
                adapter_hint = ?
              WHERE id = ?
            `,
          )
          .run(
            input.planVersionId,
            taskDraft.title,
            taskDraft.description,
            taskDraft.status,
            index,
            taskDraft.riskLevel,
            taskDraft.adapterHint,
            existingTask.id,
          );

        if (wasChanged) {
          refreshedCount += 1;
        }

        return;
      }

      if (closedTaskKeys.has(taskDraft.taskKey)) {
        return;
      }

      insertTask(database, {
        projectId: input.projectId,
        planVersionId: input.planVersionId,
        orderIndex: index,
        driftStatus: "aligned",
        task: taskDraft,
      });
      createdCount += 1;
    });

    mutableOpenTasks.forEach((task) => {
      if (matchedTaskIds.has(task.id)) {
        return;
      }

      if (task.driftStatus !== "superseded") {
        supersededCount += 1;
      }

      database
        .prepare(
          `
            UPDATE tasks
            SET drift_status = 'superseded'
            WHERE id = ?
          `,
        )
        .run(task.id);
    });

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return {
    tasks: listTasksByProjectId(database, input.projectId),
    createdCount,
    refreshedCount,
    supersededCount,
  };
}

export function markOpenTasksMaybeStale(
  database: DatabaseSync,
  input: {
    projectId: string;
    latestPlanVersionId: string;
    activeTaskId?: string | null;
  },
): number {
  const tasks = listStoredTasksByProjectId(database, input.projectId);
  const activeTaskId = input.activeTaskId ?? null;
  const staleCandidateIds = tasks
    .filter(
      (task) =>
        isOpenTaskStatus(task.status) &&
        task.id !== activeTaskId &&
        task.planVersionId !== input.latestPlanVersionId &&
        task.driftStatus === "aligned",
    )
    .map((task) => task.id);

  if (staleCandidateIds.length === 0) {
    return 0;
  }

  const markTaskMaybeStale = database.prepare(
    `
      UPDATE tasks
      SET drift_status = 'maybe_stale'
      WHERE id = ?
    `,
  );

  database.exec("BEGIN");

  try {
    staleCandidateIds.forEach((taskId) => {
      markTaskMaybeStale.run(taskId);
    });

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return staleCandidateIds.length;
}

export function listTasksByProjectId(
  database: DatabaseSync,
  projectId: string,
): Task[] {
  return listStoredTasksByProjectId(database, projectId).map(stripTaskKey);
}

export function getTaskById(database: DatabaseSync, id: string): Task | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          project_id,
          plan_version_id,
          task_key,
          title,
          description,
          status,
          drift_status,
          order_index,
          risk_level,
          adapter_hint,
          created_at
        FROM tasks
        WHERE id = ?
      `,
    )
    .get(id) as TaskRow | undefined;

  return row ? stripTaskKey(mapTaskRow(row)) : null;
}

export function updateTaskStatus(
  database: DatabaseSync,
  input: { id: string; status: TaskStatus },
): Task | null {
  const existingTask = getTaskById(database, input.id);

  if (!existingTask) {
    return null;
  }

  database
    .prepare(
      `
        UPDATE tasks
        SET status = ?
        WHERE id = ?
      `,
    )
    .run(input.status, input.id);

  return getTaskById(database, input.id);
}

export function getOpenTaskCountByPlanVersion(
  database: DatabaseSync,
  projectId: string,
  planVersionId: string,
) {
  const row = database
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE project_id = ?
          AND plan_version_id = ?
          AND status IN ('queued', 'blocked')
          AND drift_status = 'aligned'
      `,
    )
    .get(projectId, planVersionId) as { count: number };

  return row.count;
}

function listStoredTasksByProjectId(
  database: DatabaseSync,
  projectId: string,
): StoredTask[] {
  const rows = database
    .prepare(
      `
        SELECT
          id,
          project_id,
          plan_version_id,
          task_key,
          title,
          description,
          status,
          drift_status,
          order_index,
          risk_level,
          adapter_hint,
          created_at
        FROM tasks
        WHERE project_id = ?
        ORDER BY
          CASE status
            WHEN 'queued' THEN 0
            WHEN 'blocked' THEN 1
            WHEN 'review_blocked' THEN 2
            WHEN 'review' THEN 3
            ELSE 4
          END,
          CASE drift_status
            WHEN 'aligned' THEN 0
            WHEN 'maybe_stale' THEN 1
            WHEN 'stale' THEN 2
            WHEN 'superseded' THEN 3
            ELSE 4
          END,
          order_index ASC,
          created_at ASC
      `,
    )
    .all(projectId) as TaskRow[];

  return rows.map(mapTaskRow);
}

function insertTask(
  database: DatabaseSync,
  input: {
    projectId: string;
    planVersionId: string;
    orderIndex: number;
    driftStatus: TaskDriftStatus;
    task: TaskDraft;
  },
) {
  const createdAt = new Date().toISOString();

  database
    .prepare(
      `
        INSERT INTO tasks (
          id,
          project_id,
          plan_version_id,
          task_key,
          title,
          description,
          status,
          drift_status,
          order_index,
          risk_level,
          adapter_hint,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      randomUUID(),
      input.projectId,
      input.planVersionId,
      input.task.taskKey,
      input.task.title,
      input.task.description,
      input.task.status,
      input.driftStatus,
      input.orderIndex,
      input.task.riskLevel,
      input.task.adapterHint,
      createdAt,
    );
}

function mapTaskRow(row: TaskRow): StoredTask {
  return {
    id: row.id,
    projectId: row.project_id,
    planVersionId: row.plan_version_id,
    title: row.title,
    description: row.description,
    status: row.status,
    driftStatus: row.drift_status,
    orderIndex: row.order_index,
    riskLevel: row.risk_level,
    adapterHint: row.adapter_hint,
    createdAt: row.created_at,
    taskKey: row.task_key,
  };
}

function stripTaskKey(task: StoredTask): Task {
  return {
    id: task.id,
    projectId: task.projectId,
    planVersionId: task.planVersionId,
    title: task.title,
    description: task.description,
    status: task.status,
    driftStatus: task.driftStatus,
    orderIndex: task.orderIndex,
    riskLevel: task.riskLevel,
    adapterHint: task.adapterHint,
    createdAt: task.createdAt,
  };
}

function isOpenTaskStatus(status: TaskStatus) {
  return status === "queued" || status === "blocked";
}

function isClosedTaskStatus(status: TaskStatus) {
  return status === "review" || status === "review_blocked";
}
