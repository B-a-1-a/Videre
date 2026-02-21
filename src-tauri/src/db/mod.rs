use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection};

use crate::{
    error::{AppResult, ErrorEnvelope},
    model::{
        AssetKind, Clip, MediaAsset, ProjectSnapshot, ProjectSummary, TimelineDto, Track, TrackKind,
    },
};

pub const SCHEMA_VERSION: i64 = 1;

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
    conn.execute_batch(include_str!("migrations/0001_init.sql"))?;

    let already_applied: i64 = conn.query_row(
        "SELECT COUNT(1) FROM schema_migrations WHERE version = ?1",
        params![SCHEMA_VERSION],
        |row| row.get(0),
    )?;

    if already_applied == 0 {
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![SCHEMA_VERSION, now_iso()],
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
