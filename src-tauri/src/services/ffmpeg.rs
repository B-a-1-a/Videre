use std::{
    path::{Path, PathBuf},
    process::Command,
};

use serde::Deserialize;
use tauri::Manager;

use crate::{
    error::{AppResult, ErrorEnvelope},
    model::AssetKind,
};

#[derive(Debug, Clone)]
pub struct ProbeMetadata {
    pub kind: AssetKind,
    pub duration_ms: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub fps: Option<f64>,
    pub sample_rate: Option<i64>,
    pub channels: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct ProbeOutput {
    streams: Vec<ProbeStream>,
    format: Option<ProbeFormat>,
}

#[derive(Debug, Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    r_frame_rate: Option<String>,
    sample_rate: Option<String>,
    channels: Option<i64>,
    duration: Option<String>,
}

pub fn resolve_binary(app: &tauri::AppHandle, base_name: &str) -> String {
    let triple = target_triple();
    let ext = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
    let binary_name = format!("{}-{}{}", base_name, triple, ext);

    let mut candidates = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(&binary_name)];

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("binaries").join(&binary_name));
    }

    for candidate in candidates {
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }

    // Dev fallback for local machines without sidecar yet.
    base_name.to_string()
}

pub fn probe_media(app: &tauri::AppHandle, input_path: &Path) -> AppResult<ProbeMetadata> {
    let ffprobe = resolve_binary(app, "ffprobe");
    let output = Command::new(ffprobe)
        .arg("-v")
        .arg("error")
        .arg("-show_streams")
        .arg("-show_format")
        .arg("-print_format")
        .arg("json")
        .arg(input_path)
        .output()
        .map_err(|e| ErrorEnvelope::internal(format!("Failed to execute ffprobe: {e}")))?;

    if !output.status.success() {
        return Err(ErrorEnvelope::internal(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    let parsed: ProbeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|e| ErrorEnvelope::internal(format!("Failed to parse ffprobe output: {e}")))?;

    let mut video_stream = None;
    let mut audio_stream = None;

    for stream in &parsed.streams {
        match stream.codec_type.as_deref() {
            Some("video") if video_stream.is_none() => video_stream = Some(stream),
            Some("audio") if audio_stream.is_none() => audio_stream = Some(stream),
            _ => {}
        }
    }

    let duration_ms = parsed
        .format
        .as_ref()
        .and_then(|f| f.duration.as_ref())
        .and_then(|d| parse_seconds_to_ms(d))
        .or_else(|| {
            video_stream
                .and_then(|s| s.duration.as_ref())
                .and_then(|d| parse_seconds_to_ms(d))
        })
        .or_else(|| {
            audio_stream
                .and_then(|s| s.duration.as_ref())
                .and_then(|d| parse_seconds_to_ms(d))
        });

    let kind = detect_kind(input_path, video_stream.is_some(), audio_stream.is_some());
    let fps = video_stream
        .and_then(|s| s.r_frame_rate.as_ref())
        .and_then(|r| parse_frame_rate(r));
    let sample_rate = audio_stream
        .and_then(|s| s.sample_rate.as_ref())
        .and_then(|sr| sr.parse::<i64>().ok());
    let channels = audio_stream.and_then(|s| s.channels);
    let width = video_stream.and_then(|s| s.width);
    let height = video_stream.and_then(|s| s.height);

    Ok(ProbeMetadata {
        kind,
        duration_ms,
        width,
        height,
        fps,
        sample_rate,
        channels,
    })
}

fn detect_kind(path: &Path, has_video: bool, has_audio: bool) -> AssetKind {
    if has_video {
        return AssetKind::Video;
    }
    if has_audio {
        return AssetKind::Audio;
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" => AssetKind::Image,
        "mp3" | "wav" | "m4a" | "aac" | "flac" => AssetKind::Audio,
        _ => AssetKind::Video,
    }
}

fn parse_seconds_to_ms(value: &str) -> Option<i64> {
    value
        .parse::<f64>()
        .ok()
        .map(|seconds| (seconds * 1000.0).round() as i64)
}

fn parse_frame_rate(value: &str) -> Option<f64> {
    let mut split = value.split('/');
    let numerator = split.next()?.parse::<f64>().ok()?;
    let denominator = split.next()?.parse::<f64>().ok()?;
    if denominator == 0.0 {
        return None;
    }
    Some(numerator / denominator)
}

fn target_triple() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return "aarch64-apple-darwin";
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return "x86_64-apple-darwin";
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return "x86_64-pc-windows-msvc";
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        return "aarch64-pc-windows-msvc";
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return "x86_64-unknown-linux-gnu";
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return "aarch64-unknown-linux-gnu";
    }

    #[allow(unreachable_code)]
    "unknown"
}
