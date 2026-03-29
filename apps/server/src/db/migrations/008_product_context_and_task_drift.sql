ALTER TABLE plan_versions ADD COLUMN version_number INTEGER;
ALTER TABLE plan_versions ADD COLUMN source_path TEXT;
ALTER TABLE plan_versions ADD COLUMN body_markdown TEXT;
ALTER TABLE plan_versions ADD COLUMN content_hash TEXT;

UPDATE plan_versions
SET version_number = (
  SELECT COUNT(*)
  FROM plan_versions AS ranked_versions
  WHERE ranked_versions.project_id = plan_versions.project_id
    AND (
      ranked_versions.created_at < plan_versions.created_at
      OR (
        ranked_versions.created_at = plan_versions.created_at
        AND ranked_versions.id <= plan_versions.id
      )
    )
)
WHERE version_number IS NULL;

UPDATE plan_versions
SET source_path = '.scratchpad/product/prd.md'
WHERE source_path IS NULL;

UPDATE plan_versions
SET content_hash = id
WHERE content_hash IS NULL;

ALTER TABLE tasks RENAME TO tasks_old;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  plan_version_id TEXT NOT NULL,
  task_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'blocked', 'review', 'review_blocked')
  ),
  drift_status TEXT NOT NULL DEFAULT 'aligned' CHECK (
    drift_status IN ('aligned', 'maybe_stale', 'stale', 'superseded')
  ),
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
SELECT
  id,
  project_id,
  plan_version_id,
  lower(replace(replace(replace(title, ' ', '-'), '/', '-'), '_', '-')),
  title,
  description,
  status,
  'aligned',
  order_index,
  risk_level,
  adapter_hint,
  created_at
FROM tasks_old;

DROP TABLE tasks_old;

CREATE INDEX IF NOT EXISTS idx_tasks_project_id
  ON tasks(project_id, order_index);

CREATE INDEX IF NOT EXISTS idx_tasks_project_task_key
  ON tasks(project_id, task_key);
