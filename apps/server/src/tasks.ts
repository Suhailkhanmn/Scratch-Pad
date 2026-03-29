import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PreferredAdapter, Task, TaskRiskLevel, TaskStatus } from "@scratch-pad/shared";

type TaskRow = {
  id: string;
  project_id: string;
  plan_version_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  order_index: number;
  risk_level: TaskRiskLevel;
  adapter_hint: PreferredAdapter;
  created_at: string;
};

export type TaskDraft = {
  title: string;
  description: string;
  status: TaskStatus;
  riskLevel: TaskRiskLevel;
  adapterHint: PreferredAdapter;
};

export function replaceProjectTasks(
  database: DatabaseSync,
  input: {
    projectId: string;
    planVersionId: string;
    tasks: TaskDraft[];
  },
): Task[] {
  const createdAt = new Date().toISOString();

  database.exec("BEGIN");

  try {
    database
      .prepare("DELETE FROM tasks WHERE project_id = ?")
      .run(input.projectId);

    const insertTask = database.prepare(
      `
        INSERT INTO tasks (
          id,
          project_id,
          plan_version_id,
          title,
          description,
          status,
          order_index,
          risk_level,
          adapter_hint,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    const tasks = input.tasks.map((task, index) => {
      const createdTask: Task = {
        id: randomUUID(),
        projectId: input.projectId,
        planVersionId: input.planVersionId,
        title: task.title,
        description: task.description,
        status: task.status,
        orderIndex: index,
        riskLevel: task.riskLevel,
        adapterHint: task.adapterHint,
        createdAt,
      };

      insertTask.run(
        createdTask.id,
        createdTask.projectId,
        createdTask.planVersionId,
        createdTask.title,
        createdTask.description,
        createdTask.status,
        createdTask.orderIndex,
        createdTask.riskLevel,
        createdTask.adapterHint,
        createdTask.createdAt,
      );

      return createdTask;
    });

    database.exec("COMMIT");

    return tasks;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listTasksByProjectId(
  database: DatabaseSync,
  projectId: string,
): Task[] {
  const rows = database
    .prepare(
      `
        SELECT
          id,
          project_id,
          plan_version_id,
          title,
          description,
          status,
          order_index,
          risk_level,
          adapter_hint,
          created_at
        FROM tasks
        WHERE project_id = ?
        ORDER BY
          CASE status
            WHEN 'queued' THEN 0
            WHEN 'review' THEN 1
            WHEN 'blocked' THEN 2
            ELSE 3
          END,
          order_index ASC,
          created_at ASC
      `,
    )
    .all(projectId) as TaskRow[];

  return rows.map(mapTaskRow);
}

export function getTaskById(database: DatabaseSync, id: string): Task | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          project_id,
          plan_version_id,
          title,
          description,
          status,
          order_index,
          risk_level,
          adapter_hint,
          created_at
        FROM tasks
        WHERE id = ?
      `,
    )
    .get(id) as TaskRow | undefined;

  return row ? mapTaskRow(row) : null;
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

function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    planVersionId: row.plan_version_id,
    title: row.title,
    description: row.description,
    status: row.status,
    orderIndex: row.order_index,
    riskLevel: row.risk_level,
    adapterHint: row.adapter_hint,
    createdAt: row.created_at,
  };
}
