use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

use hex::ToHex;
use rusqlite::params;
use sha2::{Digest, Sha256};

use crate::{
    db::{now_iso, open_connection, project_db_path, touch_project},
    error::{AppResult, ErrorEnvelope},
    model::{AssetKind, ImportBatchResult, MediaAsset, OpResult},
    services::{ffmpeg, import_pipeline},
    state::AppState,
};

#[tauri::command]
pub fn media_import(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
    source_paths: Vec<String>,
) -> AppResult<ImportBatchResult> {
    if source_paths.is_empty() {
        return Err(ErrorEnvelope::invalid_input("No source files provided"));
    }

    let project_root = super::project::resolve_project_root(&app, &state, &project_id)?;
    let db_path = project_db_path(&project_root);
    let conn = open_connection(&db_path)?;

    let mut imported = Vec::new();

    for source in source_paths {
        let source_path = PathBuf::from(&source);
        if !source_path.exists() || !source_path.is_file() {
            continue;
        }

        let canonical_source = source_path.canonicalize().map_err(|e| {
            ErrorEnvelope::invalid_input(format!("Invalid source path '{source}': {e}"))
        })?;

        let hash = sha256_path(&canonical_source)?;
        let ext = canonical_source
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("bin");

        let managed_file_name = format!("{hash}.{ext}");
        let managed_path = project_root.join("media/originals").join(managed_file_name);
        if !managed_path.exists() {
            fs::copy(&canonical_source, &managed_path).map_err(|e| {
                ErrorEnvelope::internal(format!(
                    "Failed to copy {}: {e}",
                    canonical_source.to_string_lossy()
                ))
            })?;
        }

        if let Some(existing) =
            find_asset_by_path(&conn, &project_id, managed_path.to_string_lossy().as_ref())?
        {
            imported.push(existing);
            continue;
        }

        let probe = ffmpeg::probe_media(&app, &managed_path)?;
        let kind = probe.kind.clone();
        let status = match kind {
            AssetKind::Image => "ready",
            _ => "processing",
        }
        .to_string();

        let asset = MediaAsset {
            id: uuid::Uuid::new_v4().to_string(),
            project_id: project_id.clone(),
            kind,
            file_name: canonical_source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("media")
                .to_string(),
            managed_path: managed_path.to_string_lossy().to_string(),
            proxy_path: None,
            waveform_path: None,
            duration_ms: probe.duration_ms,
            width: probe.width,
            height: probe.height,
            fps: probe.fps,
            sample_rate: probe.sample_rate,
            channels: probe.channels,
            status,
        };

        insert_asset(&conn, &asset)?;

        if !matches!(asset.kind, AssetKind::Image) {
            import_pipeline::enqueue_asset_processing(
                app.clone(),
                project_root.clone(),
                project_id.clone(),
                asset.id.clone(),
                asset.kind.clone(),
                asset.managed_path.clone(),
            );
        }

        imported.push(asset);
    }

    touch_project(&conn, &project_id)?;

    Ok(ImportBatchResult { imported })
}

#[tauri::command]
pub fn media_remove(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_id: String,
    asset_id: String,
) -> AppResult<OpResult> {
    let project_root = super::project::resolve_project_root(&app, &state, &project_id)?;
    let db_path = project_db_path(&project_root);
    let conn = open_connection(&db_path)?;

    let managed_path: String = conn
        .query_row(
            "SELECT managed_path FROM media_assets WHERE id = ?1 AND project_id = ?2",
            params![&asset_id, &project_id],
            |row| row.get(0),
        )
        .map_err(|_| ErrorEnvelope::not_found("Asset not found"))?;

    conn.execute(
        "DELETE FROM media_assets WHERE id = ?1 AND project_id = ?2",
        params![&asset_id, &project_id],
    )?;

    let media_root = project_root
        .join("media/originals")
        .canonicalize()
        .map_err(|e| {
            ErrorEnvelope::internal(format!(
                "Failed to resolve media root for safety check: {e}"
            ))
        })?;
    let path = PathBuf::from(managed_path);
    if path.exists() && is_path_within_root(&path, &media_root) {
        fs::remove_file(path).ok();
    }

    Ok(OpResult {
        ok: true,
        message: "Asset removed".to_string(),
    })
}

fn sha256_path(path: &PathBuf) -> AppResult<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();

    let mut buffer = [0_u8; 8192];
    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    let digest = hasher.finalize();
    Ok(digest.encode_hex::<String>())
}

fn insert_asset(conn: &rusqlite::Connection, asset: &MediaAsset) -> AppResult<()> {
    conn.execute(
        "INSERT INTO media_assets (
            id, project_id, kind, file_name, managed_path, proxy_path, waveform_path,
            duration_ms, width, height, fps, sample_rate, channels, status, created_at, updated_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
        )",
        params![
            &asset.id,
            &asset.project_id,
            asset_kind_str(&asset.kind),
            &asset.file_name,
            &asset.managed_path,
            &asset.proxy_path,
            &asset.waveform_path,
            asset.duration_ms,
            asset.width,
            asset.height,
            asset.fps,
            asset.sample_rate,
            asset.channels,
            &asset.status,
            now_iso(),
            now_iso(),
        ],
    )?;

    Ok(())
}

fn find_asset_by_path(
    conn: &rusqlite::Connection,
    project_id: &str,
    managed_path: &str,
) -> AppResult<Option<MediaAsset>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, kind, file_name, managed_path, proxy_path, waveform_path,
                duration_ms, width, height, fps, sample_rate, channels, status
         FROM media_assets
         WHERE project_id = ?1 AND managed_path = ?2
         LIMIT 1",
    )?;

    let mut rows = stmt.query(params![project_id, managed_path])?;
    if let Some(row) = rows.next()? {
        let kind: String = row.get(2)?;
        return Ok(Some(MediaAsset {
            id: row.get(0)?,
            project_id: row.get(1)?,
            kind: parse_kind(&kind),
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
        }));
    }

    Ok(None)
}

fn asset_kind_str(kind: &AssetKind) -> &'static str {
    match kind {
        AssetKind::Video => "video",
        AssetKind::Audio => "audio",
        AssetKind::Image => "image",
    }
}

fn parse_kind(kind: &str) -> AssetKind {
    match kind {
        "audio" => AssetKind::Audio,
        "image" => AssetKind::Image,
        _ => AssetKind::Video,
    }
}

fn is_path_within_root(path: &Path, root: &Path) -> bool {
    match path.canonicalize() {
        Ok(canonical) => canonical.starts_with(root),
        Err(_) => false,
    }
}
