use rusqlite::params;

use crate::{
    db::{get_timeline, now_iso, open_connection, project_db_path, touch_project},
    error::{AppResult, ErrorEnvelope},
    model::{TimelineDto, TimelineOperation, TimelinePatchDto, TrackKind},
    state::AppState,
};

#[tauri::command]
pub fn timeline_get(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> AppResult<TimelineDto> {
    let root = super::project::resolve_project_root(&app, &state, &project_id)?;
    let conn = open_connection(&project_db_path(&root))?;
    get_timeline(&conn, &project_id)
}

#[tauri::command]
pub fn timeline_apply_patch(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
    patch: TimelinePatchDto,
) -> AppResult<TimelineDto> {
    let root = super::project::resolve_project_root(&app, &state, &project_id)?;
    let db_path = project_db_path(&root);
    let mut conn = open_connection(&db_path)?;

    let tx = conn.transaction()?;

    for op in patch.operations {
        match op {
            TimelineOperation::AddTrack { kind, name } => {
                let next_index: i64 = tx.query_row(
                    "SELECT COALESCE(MAX(order_index), -1) + 1 FROM tracks WHERE project_id = ?1",
                    params![&project_id],
                    |row| row.get(0),
                )?;

                tx.execute(
                    "INSERT INTO tracks (id, project_id, kind, order_index, name, muted, locked, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, ?6, ?7)",
                    params![
                        uuid::Uuid::new_v4().to_string(),
                        &project_id,
                        track_kind_str(&kind),
                        next_index,
                        name,
                        now_iso(),
                        now_iso(),
                    ],
                )?;
            }
            TimelineOperation::RemoveTrack { track_id } => {
                tx.execute(
                    "DELETE FROM tracks WHERE id = ?1 AND project_id = ?2",
                    params![track_id, &project_id],
                )?;
            }
            TimelineOperation::ReorderTrack {
                track_id,
                new_index,
            } => {
                let mut stmt = tx.prepare(
                    "SELECT id FROM tracks WHERE project_id = ?1 ORDER BY order_index ASC",
                )?;
                let rows = stmt.query_map(params![&project_id], |row| row.get::<_, String>(0))?;

                let mut track_ids = Vec::new();
                for row in rows {
                    track_ids.push(row?);
                }
                if track_ids.is_empty() {
                    continue;
                }

                if let Some(old_index) = track_ids.iter().position(|id| id == &track_id) {
                    let moving = track_ids.remove(old_index);
                    let clamped = (new_index.max(0) as usize).min(track_ids.len());
                    track_ids.insert(clamped, moving);

                    for (index, id) in track_ids.iter().enumerate() {
                        tx.execute(
                            "UPDATE tracks SET order_index = ?1, updated_at = ?2 WHERE id = ?3 AND project_id = ?4",
                            params![index as i64, now_iso(), id, &project_id],
                        )?;
                    }
                }
            }
            TimelineOperation::AddClip {
                track_id,
                asset_id,
                timeline_start_ms,
                source_in_ms,
                source_out_ms,
                linked_group_id,
                gain_db,
            } => {
                validate_source_range(source_in_ms, source_out_ms)?;
                tx.execute(
                    "INSERT INTO clips (id, project_id, track_id, asset_id, timeline_start_ms, source_in_ms, source_out_ms, linked_group_id, gain_db, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        uuid::Uuid::new_v4().to_string(),
                        &project_id,
                        track_id,
                        asset_id,
                        timeline_start_ms,
                        source_in_ms,
                        source_out_ms,
                        linked_group_id,
                        gain_db,
                        now_iso(),
                        now_iso(),
                    ],
                )?;
            }
            TimelineOperation::MoveClip {
                clip_id,
                track_id,
                timeline_start_ms,
            } => {
                tx.execute(
                    "UPDATE clips
                     SET track_id = COALESCE(?1, track_id),
                         timeline_start_ms = ?2,
                         updated_at = ?3
                     WHERE id = ?4 AND project_id = ?5",
                    params![track_id, timeline_start_ms, now_iso(), clip_id, &project_id],
                )?;
            }
            TimelineOperation::TrimClip {
                clip_id,
                source_in_ms,
                source_out_ms,
            } => {
                validate_source_range(source_in_ms, source_out_ms)?;
                tx.execute(
                    "UPDATE clips
                     SET source_in_ms = ?1,
                         source_out_ms = ?2,
                         updated_at = ?3
                     WHERE id = ?4 AND project_id = ?5",
                    params![source_in_ms, source_out_ms, now_iso(), clip_id, &project_id],
                )?;
            }
            TimelineOperation::SplitClip {
                clip_id,
                at_timeline_ms,
            } => {
                let row = tx.query_row(
                    "SELECT track_id, asset_id, timeline_start_ms, source_in_ms, source_out_ms, linked_group_id, gain_db
                     FROM clips
                     WHERE id = ?1 AND project_id = ?2",
                    params![&clip_id, &project_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, i64>(3)?,
                            row.get::<_, i64>(4)?,
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, Option<f64>>(6)?,
                        ))
                    },
                ).map_err(|_| ErrorEnvelope::not_found("Clip not found"))?;

                let (
                    track_id,
                    asset_id,
                    timeline_start,
                    source_in,
                    source_out,
                    linked_group_id,
                    gain_db,
                ) = row;
                let duration = source_out - source_in;
                let timeline_end = timeline_start + duration;
                if at_timeline_ms <= timeline_start || at_timeline_ms >= timeline_end {
                    return Err(ErrorEnvelope::invalid_input(
                        "Split point must be inside clip bounds",
                    ));
                }

                let split_source = source_in + (at_timeline_ms - timeline_start);
                tx.execute(
                    "UPDATE clips SET source_out_ms = ?1, updated_at = ?2 WHERE id = ?3 AND project_id = ?4",
                    params![split_source, now_iso(), &clip_id, &project_id],
                )?;

                tx.execute(
                    "INSERT INTO clips (id, project_id, track_id, asset_id, timeline_start_ms, source_in_ms, source_out_ms, linked_group_id, gain_db, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        uuid::Uuid::new_v4().to_string(),
                        &project_id,
                        track_id,
                        asset_id,
                        at_timeline_ms,
                        split_source,
                        source_out,
                        linked_group_id,
                        gain_db,
                        now_iso(),
                        now_iso(),
                    ],
                )?;
            }
            TimelineOperation::DeleteClip { clip_id } => {
                tx.execute(
                    "DELETE FROM clips WHERE id = ?1 AND project_id = ?2",
                    params![clip_id, &project_id],
                )?;
            }
        }
    }

    tx.commit()?;

    let conn = open_connection(&db_path)?;
    touch_project(&conn, &project_id)?;
    get_timeline(&conn, &project_id)
}

fn validate_source_range(source_in_ms: i64, source_out_ms: i64) -> AppResult<()> {
    if source_in_ms < 0 || source_out_ms <= source_in_ms {
        return Err(ErrorEnvelope::invalid_input(
            "sourceOutMs must be greater than sourceInMs and both must be >= 0",
        ));
    }
    Ok(())
}

fn track_kind_str(kind: &TrackKind) -> &'static str {
    match kind {
        TrackKind::Video => "video",
        TrackKind::Audio => "audio",
    }
}
