use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use rusqlite::params;
use serde::Serialize;
use tauri::Emitter;

use crate::{
    db::{open_connection, project_db_path},
    model::AssetKind,
    services::ffmpeg,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportEvent {
    project_id: String,
    asset_id: String,
    status: String,
    progress: f64,
    message: String,
}

pub fn enqueue_asset_processing(
    app: tauri::AppHandle,
    project_root: PathBuf,
    project_id: String,
    asset_id: String,
    kind: AssetKind,
    managed_path: String,
) {
    tauri::async_runtime::spawn(async move {
        let db_path = project_db_path(&project_root);
        let _ = app.emit(
            "import://progress",
            ImportEvent {
                project_id: project_id.clone(),
                asset_id: asset_id.clone(),
                status: "running".to_string(),
                progress: 0.05,
                message: "Ingest started".to_string(),
            },
        );

        let mut proxy_out: Option<String> = None;
        let mut waveform_out: Option<String> = None;

        let result = (|| -> anyhow::Result<()> {
            match kind {
                AssetKind::Video => {
                    proxy_out = Some(generate_proxy(
                        &app,
                        &project_root,
                        &asset_id,
                        &managed_path,
                    )?);
                    let _ = app.emit(
                        "import://progress",
                        ImportEvent {
                            project_id: project_id.clone(),
                            asset_id: asset_id.clone(),
                            status: "running".to_string(),
                            progress: 0.6,
                            message: "Proxy generated".to_string(),
                        },
                    );
                    waveform_out = Some(generate_waveform(
                        &app,
                        &project_root,
                        &asset_id,
                        &managed_path,
                    )?);
                }
                AssetKind::Audio => {
                    waveform_out = Some(generate_waveform(
                        &app,
                        &project_root,
                        &asset_id,
                        &managed_path,
                    )?);
                }
                AssetKind::Image => {
                    // No background processing required for images in v1.
                }
            }
            Ok(())
        })();

        match result {
            Ok(()) => {
                let _ = update_asset_status(
                    &db_path,
                    &asset_id,
                    "ready",
                    proxy_out.as_deref(),
                    waveform_out.as_deref(),
                );

                let _ = app.emit(
                    "import://done",
                    ImportEvent {
                        project_id,
                        asset_id,
                        status: "done".to_string(),
                        progress: 1.0,
                        message: "Ingest completed".to_string(),
                    },
                );
            }
            Err(error) => {
                let _ = update_asset_status(&db_path, &asset_id, "failed", None, None);
                let _ = app.emit(
                    "import://failed",
                    ImportEvent {
                        project_id,
                        asset_id,
                        status: "failed".to_string(),
                        progress: 1.0,
                        message: error.to_string(),
                    },
                );
            }
        }
    });
}

fn generate_proxy(
    app: &tauri::AppHandle,
    project_root: &Path,
    asset_id: &str,
    managed_path: &str,
) -> anyhow::Result<String> {
    let proxy_path = project_root
        .join("media/proxies")
        .join(format!("{asset_id}.mp4"));

    let ffmpeg_bin = ffmpeg::resolve_binary(app, "ffmpeg");

    let output = Command::new(ffmpeg_bin)
        .arg("-y")
        .arg("-i")
        .arg(managed_path)
        .arg("-vf")
        .arg("scale='min(1280,iw)':-2")
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("veryfast")
        .arg("-crf")
        .arg("28")
        .arg("-c:a")
        .arg("aac")
        .arg("-movflags")
        .arg("+faststart")
        .arg(&proxy_path)
        .output()?;

    if !output.status.success() {
        anyhow::bail!(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(proxy_path.to_string_lossy().to_string())
}

fn generate_waveform(
    app: &tauri::AppHandle,
    project_root: &Path,
    asset_id: &str,
    managed_path: &str,
) -> anyhow::Result<String> {
    let waveform_path = project_root
        .join("media/waveforms")
        .join(format!("{asset_id}.json"));

    let ffmpeg_bin = ffmpeg::resolve_binary(app, "ffmpeg");
    let output = Command::new(ffmpeg_bin)
        .arg("-v")
        .arg("error")
        .arg("-i")
        .arg(managed_path)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("8000")
        .arg("-f")
        .arg("s16le")
        .arg("-")
        .output()?;

    if !output.status.success() {
        anyhow::bail!(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let peaks = compute_peaks(&output.stdout, 400);
    let payload = serde_json::json!({
        "sampleRate": 8000,
        "windowSize": 400,
        "peaks": peaks,
    });

    fs::write(&waveform_path, serde_json::to_string(&payload)?)?;

    Ok(waveform_path.to_string_lossy().to_string())
}

fn compute_peaks(raw_pcm: &[u8], window_size: usize) -> Vec<f32> {
    let mut samples = Vec::with_capacity(raw_pcm.len() / 2);
    for chunk in raw_pcm.chunks_exact(2) {
        let value = i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / i16::MAX as f32;
        samples.push(value.abs());
    }

    if samples.is_empty() {
        return vec![];
    }

    let mut peaks = Vec::new();
    let mut index = 0;
    while index < samples.len() {
        let end = (index + window_size).min(samples.len());
        let mut peak = 0.0_f32;
        for sample in &samples[index..end] {
            if *sample > peak {
                peak = *sample;
            }
        }
        peaks.push(peak);
        index = end;
    }

    peaks
}

fn update_asset_status(
    db_path: &Path,
    asset_id: &str,
    status: &str,
    proxy_path: Option<&str>,
    waveform_path: Option<&str>,
) -> anyhow::Result<()> {
    let conn = open_connection(db_path).map_err(|e| anyhow::anyhow!(e.message))?;

    conn.execute(
        "UPDATE media_assets
         SET status = ?1,
             proxy_path = COALESCE(?2, proxy_path),
             waveform_path = COALESCE(?3, waveform_path),
             updated_at = ?4
         WHERE id = ?5",
        params![
            status,
            proxy_path,
            waveform_path,
            crate::db::now_iso(),
            asset_id,
        ],
    )?;

    Ok(())
}
