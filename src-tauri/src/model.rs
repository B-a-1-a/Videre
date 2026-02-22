use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Video,
    Audio,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Video,
    Audio,
    Image,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Done,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub summary: ProjectSummary,
    pub assets: Vec<MediaAsset>,
    pub timeline: TimelineDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStateDto {
    pub timeline: serde_json::Value,
    pub text_bin_items: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStateSnapshot {
    pub summary: ProjectSummary,
    pub assets: Vec<MediaAsset>,
    pub timeline: serde_json::Value,
    pub text_bin_items: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub project_id: String,
    pub saved_at: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpResult {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub id: String,
    pub project_id: String,
    pub kind: AssetKind,
    pub file_name: String,
    pub managed_path: String,
    pub proxy_path: Option<String>,
    pub waveform_path: Option<String>,
    pub duration_ms: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub fps: Option<f64>,
    pub sample_rate: Option<i64>,
    pub channels: Option<i64>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub project_id: String,
    pub kind: TrackKind,
    pub order_index: i64,
    pub name: String,
    pub muted: bool,
    pub locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub project_id: String,
    pub track_id: String,
    pub asset_id: String,
    pub timeline_start_ms: i64,
    pub source_in_ms: i64,
    pub source_out_ms: i64,
    pub linked_group_id: Option<String>,
    pub gain_db: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextOverlay {
    pub id: String,
    pub clip_id: String,
    pub content: String,
    pub font_family: String,
    pub font_size: i64,
    pub font_weight: String,
    pub font_color: String,
    pub background_color: Option<String>,
    pub text_align: String,
    pub position_x: f64,
    pub position_y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub id: String,
    pub project_id: String,
    pub track_id: String,
    pub from_clip_id: String,
    pub to_clip_id: String,
    pub transition_type: String,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineDto {
    pub project_id: String,
    pub fps: i64,
    pub duration_ms: i64,
    pub tracks: Vec<Track>,
    pub clips: Vec<Clip>,
    pub text_overlays: Vec<TextOverlay>,
    pub transitions: Vec<Transition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePatchDto {
    pub operations: Vec<TimelineOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TimelineOperation {
    AddTrack {
        kind: TrackKind,
        name: String,
    },
    RemoveTrack {
        track_id: String,
    },
    ReorderTrack {
        track_id: String,
        new_index: i64,
    },
    AddClip {
        track_id: String,
        asset_id: String,
        timeline_start_ms: i64,
        source_in_ms: i64,
        source_out_ms: i64,
        linked_group_id: Option<String>,
        gain_db: Option<f64>,
    },
    MoveClip {
        clip_id: String,
        track_id: Option<String>,
        timeline_start_ms: i64,
    },
    TrimClip {
        clip_id: String,
        source_in_ms: i64,
        source_out_ms: i64,
    },
    SplitClip {
        clip_id: String,
        at_timeline_ms: i64,
    },
    DeleteClip {
        clip_id: String,
    },
    AddTextClip {
        track_id: String,
        timeline_start_ms: i64,
        duration_ms: i64,
        content: String,
        font_family: Option<String>,
        font_size: Option<i64>,
        font_color: Option<String>,
        font_weight: Option<String>,
        text_align: Option<String>,
        position_x: Option<f64>,
        position_y: Option<f64>,
    },
    UpdateTextOverlay {
        clip_id: String,
        content: Option<String>,
        font_family: Option<String>,
        font_size: Option<i64>,
        font_color: Option<String>,
        font_weight: Option<String>,
        text_align: Option<String>,
        background_color: Option<String>,
        position_x: Option<f64>,
        position_y: Option<f64>,
    },
    AddTransition {
        track_id: String,
        from_clip_id: String,
        to_clip_id: String,
        transition_type: String,
        duration_ms: i64,
    },
    UpdateTransition {
        transition_id: String,
        transition_type: Option<String>,
        duration_ms: Option<i64>,
    },
    DeleteTransition {
        transition_id: String,
    },
    SetLinkedGroup {
        clip_id: String,
        linked_group_id: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderSettingsDto {
    pub output_name: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub fps: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderJobDto {
    pub id: String,
    pub project_id: String,
    pub status: JobStatus,
    pub output_path: Option<String>,
    pub progress: f64,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatchResult {
    pub imported: Vec<MediaAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisJobDto {
    pub id: String,
    pub project_id: String,
    pub job_kind: String,
    pub status: JobStatus,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatsDto {
    pub used_bytes: i64,
    pub limit_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderCapabilitiesDto {
    pub remotion_enabled: bool,
    pub reason: Option<String>,
}
