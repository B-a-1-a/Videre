CREATE TABLE IF NOT EXISTS transitions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  from_clip_id TEXT NOT NULL,
  to_clip_id TEXT NOT NULL,
  transition_type TEXT NOT NULL DEFAULT 'fade',
  duration_ms INTEGER NOT NULL DEFAULT 500,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(from_clip_id) REFERENCES clips(id) ON DELETE CASCADE,
  FOREIGN KEY(to_clip_id) REFERENCES clips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transitions_project_id ON transitions(project_id);
