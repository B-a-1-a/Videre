mod commands;
mod db;
mod error;
mod model;
mod services {
    pub mod ffmpeg;
    pub mod import_pipeline;
    pub mod render_pipeline;
}
mod state;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::project::project_create,
            commands::project::project_open,
            commands::project::project_save,
            commands::project::project_list_recent,
            commands::media::media_import,
            commands::media::media_remove,
            commands::timeline::timeline_get,
            commands::timeline::timeline_apply_patch,
            commands::timeline::timeline_get_json,
            commands::timeline::timeline_save_json,
            commands::render::render_start,
            commands::render::render_status,
            commands::render::render_cancel,
            commands::analysis_stub::analysis_enqueue_stub,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
