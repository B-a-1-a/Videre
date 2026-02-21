use rusqlite::params;

use crate::{
    db::{now_iso, open_connection, project_db_path},
    error::AppResult,
    model::{AnalysisJobDto, JobStatus},
    state::AppState,
};

#[tauri::command]
pub fn analysis_enqueue_stub(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
    job_kind: String,
) -> AppResult<AnalysisJobDto> {
    let project_root = super::project::resolve_project_root(&app, &state, &project_id)?;
    let db_path = project_db_path(&project_root);
    let conn = open_connection(&db_path)?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = now_iso();
    let message = "AI processing is not implemented in this version".to_string();

    conn.execute(
        "INSERT INTO analysis_jobs (id, project_id, job_kind, status, message, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'failed', ?4, ?5, ?6)",
        params![&id, &project_id, &job_kind, &message, &now, &now],
    )?;

    Ok(AnalysisJobDto {
        id,
        project_id,
        job_kind,
        status: JobStatus::Failed,
        message,
    })
}
