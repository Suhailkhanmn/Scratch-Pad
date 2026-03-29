CREATE TABLE IF NOT EXISTS plan_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  acceptance_json TEXT NOT NULL,
  non_goals_json TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_versions_project_id
  ON plan_versions(project_id);

