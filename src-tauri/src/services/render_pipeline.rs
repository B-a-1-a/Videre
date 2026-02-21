use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{atomic::Ordering, Arc},
    thread,
    time::Duration,
};

use anyhow::Context;
use rusqlite::params;
use serde::Serialize;
use tauri::{Emitter, Manager};

use crate::{
    db::{now_iso, open_connection, project_db_path},
    model::RenderSettingsDto,
    state::AppState,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderEvent {
    project_id: String,
    job_id: String,
    status: String,
    progress: f64,
    output_path: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct RenderClipInput {
    track_kind: String,
    track_order: i64,
    asset_kind: String,
    has_audio: bool,
    managed_path: String,
    timeline_start_ms: i64,
    source_in_ms: i64,
    source_out_ms: i64,
    gain_db: Option<f64>,
}

#[derive(Debug, Clone)]
struct ProjectVideoSettings {
    width: i64,
    height: i64,
    fps: i64,
}

pub fn spawn_render_job(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    project_root: PathBuf,
    project_id: String,
    job_id: String,
    settings: RenderSettingsDto,
) {
    let cancel_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    state.set_render_cancel_flag(job_id.clone(), cancel_flag.clone());

    tauri::async_runtime::spawn(async move {
        let db_path = project_db_path(&project_root);

        let result = (|| -> anyhow::Result<String> {
            update_job(&db_path, &job_id, "running", 0.05, None, None)?;
            let _ = app.emit(
                "render://progress",
                RenderEvent {
                    project_id: project_id.clone(),
                    job_id: job_id.clone(),
                    status: "running".to_string(),
                    progress: 0.05,
                    output_path: None,
                    error: None,
                },
            );

            let project_settings = load_project_settings(&db_path, &project_id)?;
            let clips = load_clips_for_render(&db_path, &project_id)?;
            let duration_ms = timeline_duration_ms(&clips);

            if duration_ms <= 0 {
                anyhow::bail!("Timeline is empty. Add clips before exporting.");
            }

            let output_name = sanitize_output_name(
                settings
                    .output_name
                    .clone()
                    .unwrap_or_else(|| format!("render-{}.mp4", job_id))
                    .as_str(),
            );
            let output_path = project_root.join("exports").join(output_name);

            execute_ffmpeg_render(
                &app,
                &project_root,
                &output_path,
                &clips,
                duration_ms,
                ProjectVideoSettings {
                    width: settings.width.unwrap_or(project_settings.width),
                    height: settings.height.unwrap_or(project_settings.height),
                    fps: settings.fps.unwrap_or(project_settings.fps),
                },
                cancel_flag,
            )?;

            Ok(output_path.to_string_lossy().to_string())
        })();

        match result {
            Ok(output_path) => {
                let _ = update_job(&db_path, &job_id, "done", 1.0, Some(&output_path), None);

                let _ = app.emit(
                    "render://done",
                    RenderEvent {
                        project_id: project_id.clone(),
                        job_id: job_id.clone(),
                        status: "done".to_string(),
                        progress: 1.0,
                        output_path: Some(output_path),
                        error: None,
                    },
                );
            }
            Err(error) => {
                let canceled = error.to_string().contains("canceled");
                let status = if canceled { "canceled" } else { "failed" };
                let _ = update_job(
                    &db_path,
                    &job_id,
                    status,
                    1.0,
                    None,
                    Some(&error.to_string()),
                );

                let _ = app.emit(
                    "render://failed",
                    RenderEvent {
                        project_id: project_id.clone(),
                        job_id: job_id.clone(),
                        status: status.to_string(),
                        progress: 1.0,
                        output_path: None,
                        error: Some(error.to_string()),
                    },
                );
            }
        }

        app.state::<AppState>().clear_render_cancel_flag(&job_id);
    });
}

fn load_project_settings(db_path: &Path, project_id: &str) -> anyhow::Result<ProjectVideoSettings> {
    let conn = open_connection(db_path).map_err(|e| anyhow::anyhow!(e.message))?;

    let settings = conn.query_row(
        "SELECT width, height, fps FROM projects WHERE id = ?1",
        params![project_id],
        |row| {
            Ok(ProjectVideoSettings {
                width: row.get(0)?,
                height: row.get(1)?,
                fps: row.get(2)?,
            })
        },
    )?;

    Ok(settings)
}

fn load_clips_for_render(db_path: &Path, project_id: &str) -> anyhow::Result<Vec<RenderClipInput>> {
    let conn = open_connection(db_path).map_err(|e| anyhow::anyhow!(e.message))?;

    let mut stmt = conn.prepare(
        "SELECT t.kind, t.order_index, ma.kind, ma.sample_rate, ma.managed_path,
                c.timeline_start_ms, c.source_in_ms, c.source_out_ms, c.gain_db
         FROM clips c
         JOIN tracks t ON t.id = c.track_id
         JOIN media_assets ma ON ma.id = c.asset_id
         WHERE c.project_id = ?1
         ORDER BY t.order_index ASC, c.timeline_start_ms ASC",
    )?;

    let rows = stmt.query_map(params![project_id], |row| {
        Ok(RenderClipInput {
            track_kind: row.get(0)?,
            track_order: row.get(1)?,
            asset_kind: row.get(2)?,
            has_audio: row.get::<_, Option<i64>>(3)?.is_some(),
            managed_path: row.get(4)?,
            timeline_start_ms: row.get(5)?,
            source_in_ms: row.get(6)?,
            source_out_ms: row.get(7)?,
            gain_db: row.get(8)?,
        })
    })?;

    let mut output = Vec::new();
    for row in rows {
        output.push(row?);
    }

    Ok(output)
}

fn timeline_duration_ms(clips: &[RenderClipInput]) -> i64 {
    clips
        .iter()
        .map(|clip| clip.timeline_start_ms + (clip.source_out_ms - clip.source_in_ms))
        .max()
        .unwrap_or(0)
}

fn execute_ffmpeg_render(
    app: &tauri::AppHandle,
    project_root: &Path,
    output_path: &Path,
    clips: &[RenderClipInput],
    duration_ms: i64,
    settings: ProjectVideoSettings,
    cancel_flag: Arc<std::sync::atomic::AtomicBool>,
) -> anyhow::Result<()> {
    #[derive(Clone)]
    struct InputSlot {
        input_index: i32,
        clip: RenderClipInput,
    }

    let mut cmd = Command::new(crate::services::ffmpeg::resolve_binary(app, "ffmpeg"));
    cmd.arg("-y");

    let duration_seconds = duration_ms as f64 / 1000.0;
    cmd.arg("-f").arg("lavfi").arg("-i").arg(format!(
        "color=c=black:s={}x{}:r={}:d={duration_seconds}",
        settings.width, settings.height, settings.fps
    ));

    let mut slots = Vec::new();
    let mut next_input_index = 1_i32;

    for clip in clips {
        if clip.asset_kind == "image" && clip.track_kind == "video" {
            let clip_len_sec = (clip.source_out_ms - clip.source_in_ms) as f64 / 1000.0;
            cmd.arg("-loop")
                .arg("1")
                .arg("-t")
                .arg(format!("{clip_len_sec:.3}"))
                .arg("-i")
                .arg(&clip.managed_path);
        } else {
            cmd.arg("-i").arg(&clip.managed_path);
        }
        slots.push(InputSlot {
            input_index: next_input_index,
            clip: clip.clone(),
        });
        next_input_index += 1;
    }

    let mut video_inputs = slots
        .iter()
        .filter(|slot| slot.clip.track_kind == "video")
        .cloned()
        .collect::<Vec<_>>();
    let mut audio_inputs = slots
        .iter()
        .filter(|slot| {
            slot.clip.track_kind == "audio"
                || (slot.clip.asset_kind == "video" && slot.clip.has_audio)
                || slot.clip.asset_kind == "audio"
        })
        .cloned()
        .collect::<Vec<_>>();

    video_inputs.sort_by_key(|slot| (slot.clip.track_order, slot.clip.timeline_start_ms));
    audio_inputs.sort_by_key(|slot| (slot.clip.track_order, slot.clip.timeline_start_ms));

    if video_inputs.is_empty() {
        anyhow::bail!("No video clips found on timeline");
    }

    let mut filter_parts = Vec::new();
    for (idx, slot) in video_inputs.iter().enumerate() {
        let start_sec = slot.clip.source_in_ms as f64 / 1000.0;
        let end_sec = slot.clip.source_out_ms as f64 / 1000.0;
        let shift_sec = slot.clip.timeline_start_ms as f64 / 1000.0;

        if slot.clip.asset_kind == "image" {
            filter_parts.push(format!(
                "[{}:v]scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2,trim=duration={:.3},setpts=PTS-STARTPTS+{shift_sec}/TB[v{idx}]",
                slot.input_index,
                settings.width,
                settings.height,
                settings.width,
                settings.height,
                end_sec - start_sec,
            ));
        } else {
            filter_parts.push(format!(
                "[{}:v]trim=start={start_sec:.3}:end={end_sec:.3},setpts=PTS-STARTPTS+{shift_sec}/TB,scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2[v{idx}]",
                slot.input_index,
                settings.width,
                settings.height,
                settings.width,
                settings.height,
            ));
        }
    }

    let mut current_video = "[0:v]".to_string();
    for idx in 0..video_inputs.len() {
        let out_label = if idx == video_inputs.len() - 1 {
            "[vout]".to_string()
        } else {
            format!("[vtmp{idx}]")
        };
        filter_parts.push(format!(
            "{current_video}[v{idx}]overlay=eof_action=pass:shortest=0{out_label}"
        ));
        current_video = out_label;
    }

    let mut audio_label_inputs = Vec::new();
    for (idx, slot) in audio_inputs.iter().enumerate() {
        let start_sec = slot.clip.source_in_ms as f64 / 1000.0;
        let end_sec = slot.clip.source_out_ms as f64 / 1000.0;
        let shift_sec = slot.clip.timeline_start_ms as f64 / 1000.0;

        let mut chain = format!(
            "[{}:a]atrim=start={start_sec:.3}:end={end_sec:.3},asetpts=PTS-STARTPTS+{shift_sec}/TB",
            slot.input_index
        );
        if let Some(gain_db) = slot.clip.gain_db {
            chain.push_str(&format!(",volume={}dB", gain_db));
        }
        chain.push_str(&format!("[a{idx}]"));
        filter_parts.push(chain);
        audio_label_inputs.push(format!("[a{idx}]"));
    }

    if !audio_label_inputs.is_empty() {
        filter_parts.push(format!(
            "{}amix=inputs={}:dropout_transition=0[aout]",
            audio_label_inputs.join(""),
            audio_label_inputs.len()
        ));
    }

    cmd.arg("-filter_complex").arg(filter_parts.join(";"));
    cmd.arg("-map").arg("[vout]");
    if !audio_label_inputs.is_empty() {
        cmd.arg("-map").arg("[aout]");
    }

    cmd.arg("-c:v")
        .arg("libx264")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-c:a")
        .arg("aac")
        .arg("-movflags")
        .arg("+faststart")
        .arg(output_path);

    cmd.current_dir(project_root);

    let mut child = cmd
        .spawn()
        .with_context(|| "Failed to spawn ffmpeg for render")?;

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            child.kill().ok();
            anyhow::bail!("Render canceled");
        }

        if let Some(status) = child.try_wait()? {
            if status.success() {
                break;
            }
            anyhow::bail!("Render failed with status: {status}");
        }

        thread::sleep(Duration::from_millis(250));
    }

    Ok(())
}

fn update_job(
    db_path: &Path,
    job_id: &str,
    status: &str,
    progress: f64,
    output_path: Option<&str>,
    error: Option<&str>,
) -> anyhow::Result<()> {
    let conn = open_connection(db_path).map_err(|e| anyhow::anyhow!(e.message))?;
    conn.execute(
        "UPDATE render_jobs
         SET status = ?1,
             progress = ?2,
             output_path = COALESCE(?3, output_path),
             error = ?4,
             updated_at = ?5
         WHERE id = ?6",
        params![status, progress, output_path, error, now_iso(), job_id],
    )?;
    Ok(())
}

fn sanitize_output_name(input: &str) -> String {
    let mut sanitized = input
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_'))
        .collect::<String>();

    if sanitized.is_empty() {
        sanitized = "output.mp4".to_string();
    }

    if !sanitized.ends_with(".mp4") {
        sanitized.push_str(".mp4");
    }

    sanitized
}
