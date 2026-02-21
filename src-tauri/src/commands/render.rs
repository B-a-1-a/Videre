use rusqlite::params;

use crate::{
    db::{now_iso, open_connection, project_db_path},
    error::{AppResult, ErrorEnvelope},
    model::{JobStatus, OpResult, RenderJobDto, RenderSettingsDto},
    services::render_pipeline,
    state::AppState,
};

#[tauri::command]
pub fn render_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
    settings: RenderSettingsDto,
) -> AppResult<RenderJobDto> {
    let project_root = super::project::resolve_project_root(&app, &state, &project_id)?;
    let db_path = project_db_path(&project_root);
    let conn = open_connection(&db_path)?;

    let job_id = uuid::Uuid::new_v4().to_string();
    let created_at = now_iso();
    conn.execute(
        "INSERT INTO render_jobs (id, project_id, status, progress, settings_json, created_at, updated_at)
         VALUES (?1, ?2, 'queued', 0, ?3, ?4, ?5)",
        params![
            &job_id,
            &project_id,
            serde_json::to_string(&settings).map_err(ErrorEnvelope::from)?,
            created_at,
            created_at,
        ],
    )?;

    let response = RenderJobDto {
        id: job_id.clone(),
        project_id: project_id.clone(),
        status: JobStatus::Queued,
        output_path: None,
        progress: 0.0,
        error: None,
        created_at: created_at.clone(),
        updated_at: created_at,
    };

    render_pipeline::spawn_render_job(app, state, project_root, project_id, job_id, settings);

    Ok(response)
}

#[tauri::command]
pub fn render_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
    job_id: String,
) -> AppResult<RenderJobDto> {
    let project_root = super::project::resolve_project_root(&app, &state, &project_id)?;
    let db_path = project_db_path(&project_root);
    let conn = open_connection(&db_path)?;

    let row = conn
        .query_row(
            "SELECT id, project_id, status, output_path, progress, error, created_at, updated_at
             FROM render_jobs
             WHERE id = ?1 AND project_id = ?2",
            params![&job_id, &project_id],
            |row| {
                let status: String = row.get(2)?;
                Ok(RenderJobDto {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    status: parse_job_status(&status),
                    output_path: row.get(3)?,
                    progress: row.get(4)?,
                    error: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        )
        .map_err(|_| ErrorEnvelope::not_found("Render job not found"))?;

    Ok(row)
}

#[tauri::command]
pub fn render_cancel(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
    job_id: String,
) -> AppResult<OpResult> {
    let project_root = super::project::resolve_project_root(&app, &state, &project_id)?;
    let db_path = project_db_path(&project_root);
    let conn = open_connection(&db_path)?;

    state.cancel_render(&job_id);
    conn.execute(
        "UPDATE render_jobs SET status = 'canceled', updated_at = ?1 WHERE id = ?2 AND project_id = ?3",
        params![now_iso(), &job_id, &project_id],
    )?;

    Ok(OpResult {
        ok: true,
        message: "Render cancellation requested".to_string(),
    })
}

fn parse_job_status(status: &str) -> JobStatus {
    match status {
        "running" => JobStatus::Running,
        "done" => JobStatus::Done,
        "failed" => JobStatus::Failed,
        "canceled" => JobStatus::Canceled,
        _ => JobStatus::Queued,
    }
}
