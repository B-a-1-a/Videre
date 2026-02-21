use std::{fs, path::PathBuf};

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::{
    db::{
        ensure_project_layout, get_project_summary, open_connection, project_db_path,
        run_migrations, touch_project,
    },
    error::{AppResult, ErrorEnvelope},
    model::{OpResult, ProjectSnapshot, ProjectSummary, SaveResult},
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
