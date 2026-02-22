use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection};

use crate::{
    error::{AppResult, ErrorEnvelope},
    model::{
        AssetKind, Clip, MediaAsset, ProjectSnapshot, ProjectSummary, TextOverlay, TimelineDto,
        Track, TrackKind, Transition,
    },
};

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn ensure_project_layout(root: &Path) -> AppResult<()> {
    fs::create_dir_all(root)?;
    fs::create_dir_all(root.join("media/originals"))?;
    fs::create_dir_all(root.join("media/proxies"))?;
    fs::create_dir_all(root.join("media/waveforms"))?;
    fs::create_dir_all(root.join("exports"))?;
    Ok(())
}

pub fn project_db_path(root: &Path) -> PathBuf {
    root.join("project.db")
}

pub fn open_connection(db_path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "foreign_keys", 1)
        .map_err(ErrorEnvelope::from)?;
    Ok(conn)
}

pub fn run_migrations(conn: &Connection) -> AppResult<()> {
    // Migration 1: initial schema (all statements use IF NOT EXISTS, safe to re-run)
    conn.execute_batch(include_str!("migrations/0001_init.sql"))?;
    let v1_applied: i64 = conn.query_row(
        "SELECT COUNT(1) FROM schema_migrations WHERE version = ?1",
        params![1_i64],
        |row| row.get(0),
    )?;
    if v1_applied == 0 {
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![1_i64, now_iso()],
        )?;
    }

    // Migration 2: add timeline_json column to projects table
    let v2_applied: i64 = conn.query_row(
        "SELECT COUNT(1) FROM schema_migrations WHERE version = ?1",
        params![2_i64],
        |row| row.get(0),
    )?;
    if v2_applied == 0 {
        conn.execute_batch(include_str!("migrations/0002_timeline_json.sql"))?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![2_i64, now_iso()],
        )?;
    }

    // Migration 3: text overlays table
    let v3_applied: i64 = conn.query_row(
        "SELECT COUNT(1) FROM schema_migrations WHERE version = ?1",
        params![3_i64],
        |row| row.get(0),
    )?;
    if v3_applied == 0 {
        conn.execute_batch(include_str!("migrations/0003_text_overlays.sql"))?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![3_i64, now_iso()],
        )?;
    }

    // Migration 4: transitions table
    let v4_applied: i64 = conn.query_row(
        "SELECT COUNT(1) FROM schema_migrations WHERE version = ?1",
        params![4_i64],
        |row| row.get(0),
    )?;
    if v4_applied == 0 {
        conn.execute_batch(include_str!("migrations/0004_transitions.sql"))?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![4_i64, now_iso()],
        )?;
    }

    // Migration 5: canonical project state column
    let v5_applied: i64 = conn.query_row(
        "SELECT COUNT(1) FROM schema_migrations WHERE version = ?1",
        params![5_i64],
        |row| row.get(0),
    )?;
    if v5_applied == 0 {
        conn.execute_batch(include_str!("migrations/0005_project_state.sql"))?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![5_i64, now_iso()],
        )?;
    }

    Ok(())
}

pub fn init_project(
    conn: &Connection,
    project_id: &str,
    name: &str,
    root_path: &str,
) -> AppResult<ProjectSummary> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![project_id, name, root_path, now, now],
    )?;

    let video_track_id = uuid::Uuid::new_v4().to_string();
    let audio_track_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO tracks (id, project_id, kind, order_index, name, muted, locked, created_at, updated_at)
          VALUES (?1, ?2, 'video', 0, 'Video 1', 0, 0, ?3, ?4)",
        params![video_track_id, project_id, now, now],
    )?;
    conn.execute(
        "INSERT INTO tracks (id, project_id, kind, order_index, name, muted, locked, created_at, updated_at)
          VALUES (?1, ?2, 'audio', 1, 'Audio 1', 0, 0, ?3, ?4)",
        params![audio_track_id, project_id, now, now],
    )?;

    Ok(ProjectSummary {
        id: project_id.to_string(),
        name: name.to_string(),
        root_path: root_path.to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn touch_project(conn: &Connection, project_id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        params![now_iso(), project_id],
    )?;
    Ok(())
}

pub fn get_project_summary(conn: &Connection) -> AppResult<ProjectSummary> {
    let mut stmt =
        conn.prepare("SELECT id, name, root_path, created_at, updated_at FROM projects LIMIT 1")?;

    let summary = stmt
        .query_row([], |row| {
            Ok(ProjectSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|_| ErrorEnvelope::not_found("Project not found in database"))?;

    Ok(summary)
}

pub fn get_assets(conn: &Connection, project_id: &str) -> AppResult<Vec<MediaAsset>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, kind, file_name, managed_path, proxy_path, waveform_path, duration_ms,
                width, height, fps, sample_rate, channels, status
         FROM media_assets
         WHERE project_id = ?1
         ORDER BY created_at ASC",
    )?;

    let rows = stmt.query_map(params![project_id], |row| {
        let kind_str: String = row.get(2)?;
        Ok(MediaAsset {
            id: row.get(0)?,
            project_id: row.get(1)?,
            kind: parse_asset_kind(&kind_str),
            file_name: row.get(3)?,
            managed_path: row.get(4)?,
            proxy_path: row.get(5)?,
            waveform_path: row.get(6)?,
            duration_ms: row.get(7)?,
            width: row.get(8)?,
            height: row.get(9)?,
            fps: row.get(10)?,
            sample_rate: row.get(11)?,
            channels: row.get(12)?,
            status: row.get(13)?,
        })
    })?;

    let mut assets = Vec::new();
    for row in rows {
        assets.push(row?);
    }
    Ok(assets)
}

pub fn get_tracks(conn: &Connection, project_id: &str) -> AppResult<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, kind, order_index, name, muted, locked
         FROM tracks
         WHERE project_id = ?1
         ORDER BY order_index ASC",
    )?;

    let rows = stmt.query_map(params![project_id], |row| {
        let kind_str: String = row.get(2)?;
        let muted: i64 = row.get(5)?;
        let locked: i64 = row.get(6)?;

        Ok(Track {
            id: row.get(0)?,
            project_id: row.get(1)?,
            kind: parse_track_kind(&kind_str),
            order_index: row.get(3)?,
            name: row.get(4)?,
            muted: muted != 0,
            locked: locked != 0,
        })
    })?;

    let mut tracks = Vec::new();
    for row in rows {
        tracks.push(row?);
    }
    Ok(tracks)
}

pub fn get_clips(conn: &Connection, project_id: &str) -> AppResult<Vec<Clip>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, track_id, asset_id, timeline_start_ms, source_in_ms, source_out_ms, linked_group_id, gain_db
         FROM clips
         WHERE project_id = ?1
         ORDER BY timeline_start_ms ASC",
    )?;

    let rows = stmt.query_map(params![project_id], |row| {
        Ok(Clip {
            id: row.get(0)?,
            project_id: row.get(1)?,
            track_id: row.get(2)?,
            asset_id: row.get(3)?,
            timeline_start_ms: row.get(4)?,
            source_in_ms: row.get(5)?,
            source_out_ms: row.get(6)?,
            linked_group_id: row.get(7)?,
            gain_db: row.get(8)?,
        })
    })?;

    let mut clips = Vec::new();
    for row in rows {
        clips.push(row?);
    }
    Ok(clips)
}

pub fn get_text_overlays(conn: &Connection, project_id: &str) -> AppResult<Vec<TextOverlay>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.clip_id, t.content, t.font_family, t.font_size, t.font_weight,
                t.font_color, t.background_color, t.text_align, t.position_x, t.position_y
         FROM text_overlays t
         JOIN clips c ON c.id = t.clip_id
         WHERE c.project_id = ?1",
    )?;

    let rows = stmt.query_map(params![project_id], |row| {
        Ok(TextOverlay {
            id: row.get(0)?,
            clip_id: row.get(1)?,
            content: row.get(2)?,
            font_family: row.get(3)?,
            font_size: row.get(4)?,
            font_weight: row.get(5)?,
            font_color: row.get(6)?,
            background_color: row.get(7)?,
            text_align: row.get(8)?,
            position_x: row.get(9)?,
            position_y: row.get(10)?,
        })
    })?;

    let mut overlays = Vec::new();
    for row in rows {
        overlays.push(row?);
    }
    Ok(overlays)
}

pub fn get_transitions(conn: &Connection, project_id: &str) -> AppResult<Vec<Transition>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, track_id, from_clip_id, to_clip_id, transition_type, duration_ms
         FROM transitions
         WHERE project_id = ?1",
    )?;

    let rows = stmt.query_map(params![project_id], |row| {
        Ok(Transition {
            id: row.get(0)?,
            project_id: row.get(1)?,
            track_id: row.get(2)?,
            from_clip_id: row.get(3)?,
            to_clip_id: row.get(4)?,
            transition_type: row.get(5)?,
            duration_ms: row.get(6)?,
        })
    })?;

    let mut transitions = Vec::new();
    for row in rows {
        transitions.push(row?);
    }
    Ok(transitions)
}

pub fn get_project_fps(conn: &Connection, project_id: &str) -> AppResult<i64> {
    let fps = conn.query_row(
        "SELECT fps FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get(0),
    )?;
    Ok(fps)
}

pub fn get_timeline(conn: &Connection, project_id: &str) -> AppResult<TimelineDto> {
    let tracks = get_tracks(conn, project_id)?;
    let clips = get_clips(conn, project_id)?;
    let text_overlays = get_text_overlays(conn, project_id)?;
    let transitions = get_transitions(conn, project_id)?;
    let fps = get_project_fps(conn, project_id)?;

    let mut duration_ms = 0_i64;
    for clip in &clips {
        let clip_duration = clip.source_out_ms - clip.source_in_ms;
        duration_ms = duration_ms.max(clip.timeline_start_ms + clip_duration);
    }

    Ok(TimelineDto {
        project_id: project_id.to_string(),
        fps,
        duration_ms,
        tracks,
        clips,
        text_overlays,
        transitions,
    })
}

pub fn get_snapshot(conn: &Connection) -> AppResult<ProjectSnapshot> {
    let summary = get_project_summary(conn)?;
    let assets = get_assets(conn, &summary.id)?;
    let timeline = get_timeline(conn, &summary.id)?;

    Ok(ProjectSnapshot {
        summary,
        assets,
        timeline,
    })
}

fn parse_asset_kind(kind: &str) -> AssetKind {
    match kind {
        "video" => AssetKind::Video,
        "audio" => AssetKind::Audio,
        "image" => AssetKind::Image,
        _ => AssetKind::Video,
    }
}

fn parse_track_kind(kind: &str) -> TrackKind {
    match kind {
        "audio" => TrackKind::Audio,
        _ => TrackKind::Video,
    }
}
