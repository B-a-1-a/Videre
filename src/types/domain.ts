export type TrackKind = "video" | "audio";
export type AssetKind = "video" | "audio" | "image";
export type JobStatus = "queued" | "running" | "done" | "failed" | "canceled";

export interface ProjectSummary {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaAsset {
  id: string;
  projectId: string;
  kind: AssetKind;
  fileName: string;
  managedPath: string;
  proxyPath?: string;
  waveformPath?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
  sampleRate?: number;
  channels?: number;
  status: string;
}

export interface Track {
  id: string;
  projectId: string;
  kind: TrackKind;
  orderIndex: number;
  name: string;
  muted: boolean;
  locked: boolean;
}

export interface Clip {
  id: string;
  projectId: string;
  trackId: string;
  assetId: string;
  timelineStartMs: number;
  sourceInMs: number;
  sourceOutMs: number;
  linkedGroupId?: string;
  gainDb?: number;
}

export interface TimelineDto {
  projectId: string;
  fps: number;
  durationMs: number;
  tracks: Track[];
  clips: Clip[];
}

export interface ProjectSnapshot {
  summary: ProjectSummary;
  assets: MediaAsset[];
  timeline: TimelineDto;
}

export interface SaveResult {
  projectId: string;
  savedAt: string;
  status: string;
}

export interface OpResult {
  ok: boolean;
  message: string;
}

export interface ImportBatchResult {
  imported: MediaAsset[];
}

export type TimelineOperation =
  | { type: "add_track"; kind: TrackKind; name: string }
  | { type: "remove_track"; trackId: string }
  | { type: "reorder_track"; trackId: string; newIndex: number }
  | {
      type: "add_clip";
      trackId: string;
      assetId: string;
      timelineStartMs: number;
      sourceInMs: number;
      sourceOutMs: number;
      linkedGroupId?: string;
      gainDb?: number;
    }
  | { type: "move_clip"; clipId: string; trackId?: string; timelineStartMs: number }
  | { type: "trim_clip"; clipId: string; sourceInMs: number; sourceOutMs: number }
  | { type: "split_clip"; clipId: string; atTimelineMs: number }
  | { type: "delete_clip"; clipId: string };

export interface TimelinePatchDto {
  operations: TimelineOperation[];
}

export interface RenderSettingsDto {
  outputName?: string;
  width?: number;
  height?: number;
  fps?: number;
}

export interface RenderJobDto {
  id: string;
  projectId: string;
  status: JobStatus;
  outputPath?: string;
  progress: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisJobDto {
  id: string;
  projectId: string;
  jobKind: string;
  status: JobStatus;
  message: string;
}

export interface ErrorEnvelope {
  code: string;
  message: string;
}
