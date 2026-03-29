ALTER TABLE runs ADD COLUMN git_base_branch TEXT;
ALTER TABLE runs ADD COLUMN git_base_commit TEXT;
ALTER TABLE runs ADD COLUMN review_branch_name TEXT;
ALTER TABLE runs ADD COLUMN review_changed_files_json TEXT;
ALTER TABLE runs ADD COLUMN review_diff_stats_json TEXT;
ALTER TABLE runs ADD COLUMN review_summary TEXT;
ALTER TABLE runs ADD COLUMN review_prepared_at TEXT;

ALTER TABLE tasks RENAME TO tasks_old;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  plan_version_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'blocked', 'review')),
  order_index INTEGER NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  adapter_hint TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id) ON DELETE CASCADE,
  CHECK (
    adapter_hint IN ('claude-code', 'codex')
    OR adapter_hint IS NULL
  )
);

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
FROM tasks_old;

DROP TABLE tasks_old;

CREATE INDEX IF NOT EXISTS idx_tasks_project_id
  ON tasks(project_id, order_index);
