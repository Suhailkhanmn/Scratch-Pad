CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_path TEXT,
  preferred_adapter TEXT,
  status TEXT NOT NULL CHECK (status = 'idle'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    preferred_adapter IN ('claude-code', 'codex')
    OR preferred_adapter IS NULL
  )
);

CREATE TABLE IF NOT EXISTS scratch_notes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scratch_notes_project_id
  ON scratch_notes(project_id);

