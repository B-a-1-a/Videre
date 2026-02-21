CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  width INTEGER NOT NULL DEFAULT 1920,
  height INTEGER NOT NULL DEFAULT 1080,
  fps INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  managed_path TEXT NOT NULL,
  proxy_path TEXT,
  waveform_path TEXT,
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  fps REAL,
  sample_rate INTEGER,
  channels INTEGER,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_assets_project_id ON media_assets(project_id);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  name TEXT NOT NULL,
  muted INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tracks_project_id ON tracks(project_id);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  timeline_start_ms INTEGER NOT NULL,
  source_in_ms INTEGER NOT NULL,
  source_out_ms INTEGER NOT NULL,
  linked_group_id TEXT,
  gain_db REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(track_id) REFERENCES tracks(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES media_assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clips_project_id ON clips(project_id);
CREATE INDEX IF NOT EXISTS idx_clips_track_id ON clips(track_id);

CREATE TABLE IF NOT EXISTS render_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL,
  output_path TEXT,
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  settings_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_render_jobs_project_id ON render_jobs(project_id);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  job_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_project_id ON analysis_jobs(project_id);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'stub',
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scene_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER,
  label TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS embedding_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_id TEXT,
  kind TEXT NOT NULL,
  vector_json TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES media_assets(id) ON DELETE SET NULL
);
