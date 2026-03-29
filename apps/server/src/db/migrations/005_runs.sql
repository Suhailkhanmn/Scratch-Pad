CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_title TEXT NOT NULL,
  adapter TEXT NOT NULL CHECK (adapter IN ('claude-code', 'codex')),
  status TEXT NOT NULL CHECK (
    status IN ('starting', 'running', 'completed', 'failed', 'cancelled')
  ),
  output_log_path TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runs_project_started_at
  ON runs(project_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_status
  ON runs(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_task_started_at
  ON runs(task_id, started_at DESC);
