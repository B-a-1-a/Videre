use rusqlite::params;

use crate::{
    db::{get_timeline, now_iso, open_connection, project_db_path, touch_project},
    error::{AppResult, ErrorEnvelope},
    model::{TimelineDto, TimelineOperation, TimelinePatchDto, TrackKind},
    state::AppState,
};

#[tauri::command]
pub fn timeline_get_json(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> AppResult<Option<String>> {
    let root = super::project::resolve_project_root(&app, &state, &project_id)?;
    let conn = open_connection(&project_db_path(&root))?;
    let result = conn.query_row(
        "SELECT timeline_json FROM projects WHERE id = ?1",
        params![&project_id],
        |row| row.get::<_, Option<String>>(0),
    );
    match result {
        Ok(json) => Ok(json),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn timeline_save_json(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
    json: String,
) -> AppResult<()> {
    let root = super::project::resolve_project_root(&app, &state, &project_id)?;
    let conn = open_connection(&project_db_path(&root))?;
    conn.execute(
        "UPDATE projects SET timeline_json = ?1, updated_at = ?2 WHERE id = ?3",
        params![json, now_iso(), &project_id],
    )?;
    Ok(())
}

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
                // Cascade: delete text overlays and transitions referencing this clip
                tx.execute(
                    "DELETE FROM text_overlays WHERE clip_id = ?1",
                    params![&clip_id],
                )?;
                tx.execute(
                    "DELETE FROM transitions WHERE from_clip_id = ?1 OR to_clip_id = ?1",
                    params![&clip_id],
                )?;
                tx.execute(
                    "DELETE FROM clips WHERE id = ?1 AND project_id = ?2",
                    params![clip_id, &project_id],
                )?;
            }
            TimelineOperation::AddTextClip {
                track_id,
                timeline_start_ms,
                duration_ms,
                content,
                font_family,
                font_size,
                font_color,
                font_weight,
                text_align,
                position_x,
                position_y,
            } => {
                let clip_id = uuid::Uuid::new_v4().to_string();
                let overlay_id = uuid::Uuid::new_v4().to_string();
                let now = now_iso();

                // Create a clip with asset_id = '__text__' sentinel
                tx.execute(
                    "INSERT INTO clips (id, project_id, track_id, asset_id, timeline_start_ms, source_in_ms, source_out_ms, linked_group_id, gain_db, created_at, updated_at)
                     VALUES (?1, ?2, ?3, '__text__', ?4, 0, ?5, NULL, NULL, ?6, ?7)",
                    params![clip_id, &project_id, track_id, timeline_start_ms, duration_ms, now, now],
                )?;

                tx.execute(
                    "INSERT INTO text_overlays (id, clip_id, content, font_family, font_size, font_weight, font_color, background_color, text_align, position_x, position_y, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?10, ?11, ?12)",
                    params![
                        overlay_id,
                        clip_id,
                        content,
                        font_family.unwrap_or_else(|| "Arial".to_string()),
                        font_size.unwrap_or(48),
                        font_weight.unwrap_or_else(|| "normal".to_string()),
                        font_color.unwrap_or_else(|| "#FFFFFF".to_string()),
                        text_align.unwrap_or_else(|| "center".to_string()),
                        position_x.unwrap_or(0.5),
                        position_y.unwrap_or(0.5),
                        now,
                        now,
                    ],
                )?;
            }
            TimelineOperation::UpdateTextOverlay {
                clip_id,
                content,
                font_family,
                font_size,
                font_color,
                font_weight,
                text_align,
                background_color,
                position_x,
                position_y,
            } => {
                let now = now_iso();
                tx.execute(
                    "UPDATE text_overlays SET
                        content = COALESCE(?1, content),
                        font_family = COALESCE(?2, font_family),
                        font_size = COALESCE(?3, font_size),
                        font_color = COALESCE(?4, font_color),
                        font_weight = COALESCE(?5, font_weight),
                        text_align = COALESCE(?6, text_align),
                        background_color = COALESCE(?7, background_color),
                        position_x = COALESCE(?8, position_x),
                        position_y = COALESCE(?9, position_y),
                        updated_at = ?10
                     WHERE clip_id = ?11",
                    params![
                        content,
                        font_family,
                        font_size,
                        font_color,
                        font_weight,
                        text_align,
                        background_color,
                        position_x,
                        position_y,
                        now,
                        clip_id,
                    ],
                )?;
            }
            TimelineOperation::AddTransition {
                track_id,
                from_clip_id,
                to_clip_id,
                transition_type,
                duration_ms,
            } => {
                let id = uuid::Uuid::new_v4().to_string();
                let now = now_iso();
                tx.execute(
                    "INSERT INTO transitions (id, project_id, track_id, from_clip_id, to_clip_id, transition_type, duration_ms, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![id, &project_id, track_id, from_clip_id, to_clip_id, transition_type, duration_ms, now, now],
                )?;
            }
            TimelineOperation::UpdateTransition {
                transition_id,
                transition_type,
                duration_ms,
            } => {
                let now = now_iso();
                tx.execute(
                    "UPDATE transitions SET
                        transition_type = COALESCE(?1, transition_type),
                        duration_ms = COALESCE(?2, duration_ms),
                        updated_at = ?3
                     WHERE id = ?4 AND project_id = ?5",
                    params![transition_type, duration_ms, now, transition_id, &project_id],
                )?;
            }
            TimelineOperation::DeleteTransition { transition_id } => {
                tx.execute(
                    "DELETE FROM transitions WHERE id = ?1 AND project_id = ?2",
                    params![transition_id, &project_id],
                )?;
            }
            TimelineOperation::SetLinkedGroup {
                clip_id,
                linked_group_id,
            } => {
                tx.execute(
                    "UPDATE clips SET linked_group_id = ?1, updated_at = ?2 WHERE id = ?3 AND project_id = ?4",
                    params![linked_group_id, now_iso(), clip_id, &project_id],
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
