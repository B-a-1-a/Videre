CREATE TABLE IF NOT EXISTS text_overlays (
  id TEXT PRIMARY KEY,
  clip_id TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  font_family TEXT NOT NULL DEFAULT 'Arial',
  font_size INTEGER NOT NULL DEFAULT 48,
  font_weight TEXT NOT NULL DEFAULT 'normal',
  font_color TEXT NOT NULL DEFAULT '#FFFFFF',
  background_color TEXT,
  text_align TEXT NOT NULL DEFAULT 'center',
  position_x REAL NOT NULL DEFAULT 0.5,
  position_y REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(clip_id) REFERENCES clips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_text_overlays_clip_id ON text_overlays(clip_id);
