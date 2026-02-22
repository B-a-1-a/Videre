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
    id: String,
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
struct RenderTextOverlay {
    timeline_start_ms: i64,
    duration_ms: i64,
    content: String,
    font_family: String,
    font_size: i64,
    font_color: String,
    font_weight: String,
    text_align: String,
    position_x: f64,
    position_y: f64,
}

#[derive(Debug, Clone)]
struct RenderTransition {
    from_clip_id: String,
    to_clip_id: String,
    transition_type: String,
    duration_ms: i64,
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
            let text_overlays = load_text_overlays_for_render(&db_path, &project_id)?;
            let transitions = load_transitions_for_render(&db_path, &project_id)?;
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
                &text_overlays,
                &transitions,
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
        "SELECT c.id, t.kind, t.order_index, ma.kind, ma.sample_rate, ma.managed_path,
                c.timeline_start_ms, c.source_in_ms, c.source_out_ms, c.gain_db
         FROM clips c
         JOIN tracks t ON t.id = c.track_id
         JOIN media_assets ma ON ma.id = c.asset_id
         WHERE c.project_id = ?1
         ORDER BY t.order_index ASC, c.timeline_start_ms ASC",
    )?;

    let rows = stmt.query_map(params![project_id], |row| {
        Ok(RenderClipInput {
            id: row.get(0)?,
            track_kind: row.get(1)?,
            track_order: row.get(2)?,
            asset_kind: row.get(3)?,
            has_audio: row.get::<_, Option<i64>>(4)?.is_some(),
            managed_path: row.get(5)?,
            timeline_start_ms: row.get(6)?,
            source_in_ms: row.get(7)?,
            source_out_ms: row.get(8)?,
            gain_db: row.get(9)?,
        })
    })?;

    let mut output = Vec::new();
    for row in rows {
        output.push(row?);
    }

    Ok(output)
}

fn load_text_overlays_for_render(db_path: &Path, project_id: &str) -> anyhow::Result<Vec<RenderTextOverlay>> {
    let conn = open_connection(db_path).map_err(|e| anyhow::anyhow!(e.message))?;

    let mut stmt = conn.prepare(
        "SELECT c.timeline_start_ms, c.source_out_ms - c.source_in_ms,
                t.content, t.font_family, t.font_size, t.font_color, t.font_weight, t.text_align,
                t.position_x, t.position_y
         FROM clips c
         JOIN text_overlays t ON t.clip_id = c.id
         WHERE c.project_id = ?1 AND c.asset_id = '__text__'",
    )?;

    let rows = stmt.query_map(params![project_id], |row| {
        Ok(RenderTextOverlay {
            timeline_start_ms: row.get(0)?,
            duration_ms: row.get(1)?,
            content: row.get(2)?,
            font_family: row.get(3)?,
            font_size: row.get(4)?,
            font_color: row.get(5)?,
            font_weight: row.get(6)?,
            text_align: row.get(7)?,
            position_x: row.get(8)?,
            position_y: row.get(9)?,
        })
    })?;

    let mut output = Vec::new();
    for row in rows {
        output.push(row?);
    }
    Ok(output)
}

fn load_transitions_for_render(db_path: &Path, project_id: &str) -> anyhow::Result<Vec<RenderTransition>> {
    let conn = open_connection(db_path).map_err(|e| anyhow::anyhow!(e.message))?;

    let mut stmt = conn.prepare(
        "SELECT from_clip_id, to_clip_id, transition_type, duration_ms
         FROM transitions
         WHERE project_id = ?1",
    )?;

    let rows = stmt.query_map(params![project_id], |row| {
        Ok(RenderTransition {
            from_clip_id: row.get(0)?,
            to_clip_id: row.get(1)?,
            transition_type: row.get(2)?,
            duration_ms: row.get(3)?,
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

/// Maps our transition type names to additional FFmpeg fade filter parameters.
/// The fade filter itself handles the alpha; for non-fade types we still use fade
/// but could add additional effects in the future.
fn map_transition_to_ffmpeg_fade(transition_type: &str) -> &'static str {
    // FFmpeg's fade filter supports color parameter for some effects.
    // For now, all transition types use standard alpha fade (crossfade via overlay).
    // More advanced types (wipe, iris, etc.) would need xfade which requires
    // a different filter graph structure. This gives a good visual result for all types.
    match transition_type {
        "fade" => "",
        "slide" => "",
        "wipe" => "",
        "flip" => "",
        "clockwipe" => "",
        "iris" => "",
        _ => "",
    }
}

fn execute_ffmpeg_render(
    app: &tauri::AppHandle,
    project_root: &Path,
    output_path: &Path,
    clips: &[RenderClipInput],
    text_overlays: &[RenderTextOverlay],
    transitions: &[RenderTransition],
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

    // Overlay applies the later input on top, so render lower tracks first and higher tracks last.
    // In this timeline, lower order_index means higher on screen.
    video_inputs.sort_by(|left, right| {
        right
            .clip
            .track_order
            .cmp(&left.clip.track_order)
            .then_with(|| left.clip.timeline_start_ms.cmp(&right.clip.timeline_start_ms))
    });
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

    // Apply transition effects (fade in/out) on individual clip streams before overlay.
    // When a transition exists between clip A → clip B, we fade-out A's tail and fade-in B's head.
    // With overlay compositing, this produces a natural crossfade.
    let from_clip_transitions: std::collections::HashMap<&str, &RenderTransition> = transitions
        .iter()
        .map(|t| (t.from_clip_id.as_str(), t))
        .collect();
    let to_clip_transitions: std::collections::HashMap<&str, &RenderTransition> = transitions
        .iter()
        .map(|t| (t.to_clip_id.as_str(), t))
        .collect();

    for (idx, slot) in video_inputs.iter().enumerate() {
        let clip_dur_sec = (slot.clip.source_out_ms - slot.clip.source_in_ms) as f64 / 1000.0;
        let mut effects = Vec::new();

        // Fade-out at end if this clip is the "from" in a transition
        if let Some(trans) = from_clip_transitions.get(slot.clip.id.as_str()) {
            let fade_dur = trans.duration_ms as f64 / 1000.0;
            let fade_start = (clip_dur_sec - fade_dur).max(0.0);
            let transition_name = map_transition_to_ffmpeg_fade(&trans.transition_type);
            effects.push(format!(
                "fade=t=out:st={fade_start:.3}:d={fade_dur:.3}{transition_name}"
            ));
        }

        // Fade-in at start if this clip is the "to" in a transition
        if let Some(trans) = to_clip_transitions.get(slot.clip.id.as_str()) {
            let fade_dur = trans.duration_ms as f64 / 1000.0;
            let transition_name = map_transition_to_ffmpeg_fade(&trans.transition_type);
            effects.push(format!(
                "fade=t=in:st=0:d={fade_dur:.3}{transition_name}"
            ));
        }

        if !effects.is_empty() {
            // Re-label the stream through the fade filters
            let fade_chain = effects.join(",");
            filter_parts.push(format!("[v{idx}]{fade_chain}[v{idx}f]"));
        }
    }

    let mut current_video = "[0:v]".to_string();
    for idx in 0..video_inputs.len() {
        let clip_id = &video_inputs[idx].clip.id;
        let has_fade = from_clip_transitions.contains_key(clip_id.as_str())
            || to_clip_transitions.contains_key(clip_id.as_str());
        let stream_label = if has_fade {
            format!("[v{idx}f]")
        } else {
            format!("[v{idx}]")
        };

        let out_label = if idx == video_inputs.len() - 1 {
            "[vout]".to_string()
        } else {
            format!("[vtmp{idx}]")
        };
        filter_parts.push(format!(
            "{current_video}{stream_label}overlay=eof_action=pass:shortest=0{out_label}"
        ));
        current_video = out_label;
    }

    // Add drawtext filters for text overlays
    if !text_overlays.is_empty() {
        let mut text_chain = Vec::new();
        for overlay in text_overlays {
            let start_sec = overlay.timeline_start_ms as f64 / 1000.0;
            let end_sec = (overlay.timeline_start_ms + overlay.duration_ms) as f64 / 1000.0;

            // Escape special characters for FFmpeg drawtext
            let escaped_text = overlay
                .content
                .replace('\\', "\\\\")
                .replace('\'', "'\\''")
                .replace(':', "\\:")
                .replace('%', "%%");

            // Map font_weight to a bold flag or fontsize multiplier
            let font_style = if overlay.font_weight == "bold" || overlay.font_weight == "700" {
                ":bold=1"
            } else {
                ""
            };

            // Position: position_x/position_y are 0..1 fractions of canvas
            let x_expr = format!("(w*{:.3}-tw/2)", overlay.position_x);
            let y_expr = format!("(h*{:.3}-th/2)", overlay.position_y);

            text_chain.push(format!(
                "drawtext=text='{escaped_text}':fontsize={}:fontcolor={}:fontfamily={}:x={x_expr}:y={y_expr}{font_style}:enable='between(t,{start_sec:.3},{end_sec:.3})'",
                overlay.font_size,
                overlay.font_color,
                overlay.font_family.replace(':', "\\:"),
            ));
        }

        // Chain: [vout]drawtext=...,...drawtext=...[vtxt]
        let label_in = "[vout]";
        let label_out = "[vtxt]";
        filter_parts.push(format!(
            "{label_in}{}{label_out}",
            text_chain.join(",")
        ));

        // Replace the video output map label
        // We'll map [vtxt] instead of [vout]
    }

    let video_out_label = if !text_overlays.is_empty() {
        "[vtxt]"
    } else {
        "[vout]"
    };

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
    cmd.arg("-map").arg(video_out_label);
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
