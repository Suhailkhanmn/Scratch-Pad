CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  plan_version_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'blocked')),
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

CREATE INDEX IF NOT EXISTS idx_tasks_project_id
  ON tasks(project_id, order_index);

