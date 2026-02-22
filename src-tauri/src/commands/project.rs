use std::{fs, path::PathBuf};

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::Manager;

use crate::{
    db::{
        ensure_project_layout, get_assets, get_project_summary, now_iso, open_connection,
        project_db_path, run_migrations, touch_project,
    },
    error::{AppResult, ErrorEnvelope},
    model::{
        OpResult, ProjectSnapshot, ProjectStateDto, ProjectStateSnapshot, ProjectSummary,
        SaveResult, StorageStatsDto,
    },
    state::AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecentProjectsFile {
    projects: Vec<ProjectSummary>,
}

#[tauri::command]
pub fn project_create(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    name: String,
    location: String,
) -> AppResult<ProjectSummary> {
    if name.trim().is_empty() {
        return Err(ErrorEnvelope::invalid_input("Project name is required"));
    }

    let base = PathBuf::from(location)
        .canonicalize()
        .map_err(|_| ErrorEnvelope::invalid_input("Location does not exist"))?;

    let slug = slugify(&name);
    let suffix = uuid::Uuid::new_v4()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    let project_root = base.join(format!("{}-{}", slug, suffix));

    ensure_project_layout(&project_root)?;
    let db_path = project_db_path(&project_root);
    let conn = open_connection(&db_path)?;
    run_migrations(&conn)?;

    let project_id = uuid::Uuid::new_v4().to_string();
    let summary = crate::db::init_project(
        &conn,
        &project_id,
        name.trim(),
        project_root.to_string_lossy().as_ref(),
    )?;

    state.set_project_root(summary.id.clone(), project_root.clone());
    persist_recent_project(&app, &summary)?;

    Ok(summary)
}

#[tauri::command]
pub fn project_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_root: String,
) -> AppResult<ProjectSnapshot> {
    let root = PathBuf::from(project_root)
        .canonicalize()
        .map_err(|_| ErrorEnvelope::invalid_input("Project folder not found"))?;
    if !root.exists() || !root.is_dir() {
        return Err(ErrorEnvelope::invalid_input("Project folder not found"));
    }

    let db_path = project_db_path(&root);
    if !db_path.exists() {
        return Err(ErrorEnvelope::invalid_input(
            "Invalid project: missing project.db",
        ));
    }

    let conn = open_connection(&db_path)?;
    run_migrations(&conn)?;

    let snapshot = crate::db::get_snapshot(&conn)?;
    state.set_project_root(snapshot.summary.id.clone(), root);
    persist_recent_project(&app, &snapshot.summary)?;

    Ok(snapshot)
}

#[tauri::command]
pub fn project_open_by_id(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> AppResult<ProjectStateSnapshot> {
    let root = resolve_project_root(&app, &state, &project_id)?;
    let db_path = project_db_path(&root);
    let conn = open_connection(&db_path)?;
    run_migrations(&conn)?;

    let summary = get_project_summary(&conn)?;
    let assets = get_assets(&conn, &summary.id)?;
    let (timeline, text_bin_items) = load_project_state_json(&conn, &summary.id)?;

    state.set_project_root(summary.id.clone(), root);
    persist_recent_project(&app, &summary)?;

    Ok(ProjectStateSnapshot {
        summary,
        assets,
        timeline,
        text_bin_items,
    })
}

#[tauri::command]
pub fn project_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> AppResult<SaveResult> {
    let root = resolve_project_root(&app, &state, &project_id)?;
    let db_path = project_db_path(&root);
    let conn = open_connection(&db_path)?;

    touch_project(&conn, &project_id)?;
    let summary = get_project_summary(&conn)?;
    persist_recent_project(&app, &summary)?;

    Ok(SaveResult {
        project_id,
        saved_at: summary.updated_at,
        status: "ok".to_string(),
    })
}

#[tauri::command]
pub fn project_list_recent(app: tauri::AppHandle) -> AppResult<Vec<ProjectSummary>> {
    Ok(read_recent_projects(&app)?.projects)
}

#[tauri::command]
pub fn project_rename(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
    name: String,
) -> AppResult<ProjectSummary> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ErrorEnvelope::invalid_input("Project name is required"));
    }

    let root = resolve_project_root(&app, &state, &project_id)?;
    let db_path = project_db_path(&root);
    let conn = open_connection(&db_path)?;
    run_migrations(&conn)?;

    let changed = conn.execute(
        "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![trimmed, now_iso(), &project_id],
    )?;
    if changed == 0 {
        return Err(ErrorEnvelope::not_found("Project not found"));
    }

    let summary = get_project_summary(&conn)?;
    persist_recent_project(&app, &summary)?;
    Ok(summary)
}

#[tauri::command]
pub fn project_save_state(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
    project_state: ProjectStateDto,
) -> AppResult<SaveResult> {
    let root = resolve_project_root(&app, &state, &project_id)?;
    let db_path = project_db_path(&root);
    let conn = open_connection(&db_path)?;
    run_migrations(&conn)?;

    conn.execute(
        "UPDATE projects
         SET timeline_json = ?1,
             text_bin_items_json = ?2,
             updated_at = ?3
         WHERE id = ?4",
        params![
            serde_json::to_string(&project_state.timeline)?,
            serde_json::to_string(&project_state.text_bin_items)?,
            now_iso(),
            &project_id
        ],
    )?;

    touch_project(&conn, &project_id)?;
    let summary = get_project_summary(&conn)?;
    persist_recent_project(&app, &summary)?;

    Ok(SaveResult {
        project_id,
        saved_at: summary.updated_at,
        status: "ok".to_string(),
    })
}

#[tauri::command]
pub fn project_storage_stats(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> AppResult<StorageStatsDto> {
    let root = resolve_project_root(&app, &state, &project_id)?;
    let db_path = project_db_path(&root);
    let conn = open_connection(&db_path)?;
    run_migrations(&conn)?;

    let assets = get_assets(&conn, &project_id)?;
    let mut used_bytes = 0_i64;

    for asset in &assets {
        used_bytes += file_len(&asset.managed_path);
        if let Some(proxy_path) = &asset.proxy_path {
            used_bytes += file_len(proxy_path);
        }
        if let Some(waveform_path) = &asset.waveform_path {
            used_bytes += file_len(waveform_path);
        }
    }

    Ok(StorageStatsDto {
        used_bytes,
        limit_bytes: 2 * 1024 * 1024 * 1024,
    })
}

#[tauri::command]
pub fn project_delete(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
) -> AppResult<OpResult> {
    let mut recent = read_recent_projects(&app)?;
    let recent_summary = recent.projects.iter().find(|p| p.id == project_id).cloned();

    let root = if let Some(path) = state.project_root(&project_id) {
        path
    } else if let Some(summary) = &recent_summary {
        PathBuf::from(&summary.root_path)
    } else {
        return Err(ErrorEnvelope::not_found("Project not found."));
    };

    let message = if root.exists() {
        if !root.is_dir() {
            return Err(ErrorEnvelope::invalid_input("Project path is not a directory."));
        }

        let db_path = project_db_path(&root);
        if db_path.exists() {
            let conn = open_connection(&db_path)?;
            let found_project_id: String =
                conn.query_row("SELECT id FROM projects LIMIT 1", params![], |row| row.get(0))?;
            if found_project_id != project_id {
                return Err(ErrorEnvelope::invalid_input(
                    "Project id does not match project folder.",
                ));
            }
        } else {
            return Err(ErrorEnvelope::invalid_input(
                "Invalid project: missing project.db",
            ));
        }

        fs::remove_dir_all(&root)?;
        "Project deleted.".to_string()
    } else {
        "Project was already missing on disk; removed from recent list.".to_string()
    };

    recent.projects.retain(|project| project.id != project_id);
    persist_recent_projects(&app, &recent)?;
    state.remove_project_root(&project_id);

    Ok(OpResult { ok: true, message })
}

pub fn resolve_project_root(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, AppState>,
    project_id: &str,
) -> AppResult<PathBuf> {
    if let Some(path) = state.project_root(project_id) {
        return Ok(path);
    }

    let recent = read_recent_projects(app)?;
    for summary in recent.projects {
        if summary.id == project_id {
            let root = PathBuf::from(&summary.root_path);
            if root.exists() {
                let conn = open_connection(&project_db_path(&root))?;
                let id: String =
                    conn.query_row("SELECT id FROM projects LIMIT 1", params![], |row| {
                        row.get(0)
                    })?;
                if id == project_id {
                    return Ok(root);
                }
            }
        }
    }

    Err(ErrorEnvelope::not_found(
        "Project is not loaded. Open the project first.",
    ))
}

fn recent_projects_path(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().app_config_dir() {
        return dir.join("videre").join("recent-projects.json");
    }
    std::env::temp_dir().join("videre-recent-projects.json")
}

fn persist_recent_project(app: &tauri::AppHandle, summary: &ProjectSummary) -> AppResult<()> {
    let mut data = read_recent_projects(app)?;
    data.projects.retain(|p| p.id != summary.id);
    data.projects.insert(0, summary.clone());
    data.projects.truncate(20);

    persist_recent_projects(app, &data)
}

fn persist_recent_projects(app: &tauri::AppHandle, data: &RecentProjectsFile) -> AppResult<()> {
    let path = recent_projects_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(data).map_err(ErrorEnvelope::from)?,
    )?;
    Ok(())
}

fn read_recent_projects(app: &tauri::AppHandle) -> AppResult<RecentProjectsFile> {
    let path = recent_projects_path(app);
    if !path.exists() {
        return Ok(RecentProjectsFile { projects: vec![] });
    }

    let content = fs::read_to_string(path)?;
    let parsed = serde_json::from_str::<RecentProjectsFile>(&content)
        .map_err(|e| ErrorEnvelope::internal(format!("Failed to read recent projects: {e}")))?;
    Ok(parsed)
}

fn slugify(name: &str) -> String {
    let mut result = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch.to_ascii_lowercase());
        } else if ch.is_whitespace() || ch == '-' || ch == '_' {
            result.push('-');
        }
    }

    while result.contains("--") {
        result = result.replace("--", "-");
    }

    let cleaned = result.trim_matches('-').to_string();
    if cleaned.is_empty() {
        "project".to_string()
    } else {
        cleaned
    }
}

fn file_len(path: &str) -> i64 {
    fs::metadata(path)
        .ok()
        .map(|meta| meta.len() as i64)
        .unwrap_or(0)
}

fn load_project_state_json(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> AppResult<(serde_json::Value, serde_json::Value)> {
    let (timeline_json, text_bin_items_json): (Option<String>, Option<String>) = conn.query_row(
        "SELECT timeline_json, text_bin_items_json FROM projects WHERE id = ?1",
        params![project_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let timeline = timeline_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .unwrap_or_else(default_timeline_state);
    let text_bin_items = text_bin_items_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .unwrap_or_else(|| json!([]));

    Ok((timeline, text_bin_items))
}

fn default_timeline_state() -> serde_json::Value {
    json!({
        "tracks": [
            { "id": "track-1", "scrubbers": [], "transitions": [] },
            { "id": "track-2", "scrubbers": [], "transitions": [] },
            { "id": "track-3", "scrubbers": [], "transitions": [] },
            { "id": "track-4", "scrubbers": [], "transitions": [] }
        ]
    })
}
