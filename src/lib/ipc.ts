import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AnalysisJobDto,
  ImportBatchResult,
  OpResult,
  ProjectSnapshot,
  ProjectSummary,
  RenderJobDto,
  RenderSettingsDto,
  SaveResult,
  TimelineDto,
  TimelinePatchDto,
} from "../types/domain";

export type ImportProgressEvent = {
  projectId: string;
  assetId: string;
  status: string;
  progress: number;
  message: string;
};

export type RenderProgressEvent = {
  projectId: string;
  jobId: string;
  status: string;
  progress: number;
  outputPath?: string;
  error?: string;
};

export async function projectCreate(name: string, location: string): Promise<ProjectSummary> {
  return invoke<ProjectSummary>("project_create", { name, location });
}

export async function projectOpen(projectRoot: string): Promise<ProjectSnapshot> {
  return invoke<ProjectSnapshot>("project_open", { projectRoot });
}

export async function projectSave(projectId: string): Promise<SaveResult> {
  return invoke<SaveResult>("project_save", { projectId });
}

export async function projectListRecent(): Promise<ProjectSummary[]> {
  return invoke<ProjectSummary[]>("project_list_recent");
}

export async function mediaImport(projectId: string, sourcePaths: string[]): Promise<ImportBatchResult> {
  return invoke<ImportBatchResult>("media_import", { projectId, sourcePaths });
}

export async function mediaRemove(projectId: string, assetId: string): Promise<OpResult> {
  return invoke<OpResult>("media_remove", { projectId, assetId });
}

export async function timelineGet(projectId: string): Promise<TimelineDto> {
  return invoke<TimelineDto>("timeline_get", { projectId });
}

export async function timelineApplyPatch(projectId: string, patch: TimelinePatchDto): Promise<TimelineDto> {
  return invoke<TimelineDto>("timeline_apply_patch", {
    projectId,
    patch: toRustTimelinePatch(patch),
  });
}

export async function renderStart(projectId: string, settings: RenderSettingsDto): Promise<RenderJobDto> {
  return invoke<RenderJobDto>("render_start", { projectId, settings });
}

export async function renderStatus(projectId: string, jobId: string): Promise<RenderJobDto> {
  return invoke<RenderJobDto>("render_status", { projectId, jobId });
}

export async function renderCancel(projectId: string, jobId: string): Promise<OpResult> {
  return invoke<OpResult>("render_cancel", { projectId, jobId });
}

export async function analysisEnqueueStub(projectId: string, jobKind: string): Promise<AnalysisJobDto> {
  return invoke<AnalysisJobDto>("analysis_enqueue_stub", { projectId, jobKind });
}

export async function onImportProgress(
  cb: (event: ImportProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<ImportProgressEvent>("import://progress", (event) => cb(event.payload));
}

export async function onImportDone(cb: (event: ImportProgressEvent) => void): Promise<UnlistenFn> {
  return listen<ImportProgressEvent>("import://done", (event) => cb(event.payload));
}

export async function onImportFailed(cb: (event: ImportProgressEvent) => void): Promise<UnlistenFn> {
  return listen<ImportProgressEvent>("import://failed", (event) => cb(event.payload));
}

export async function onRenderProgress(
  cb: (event: RenderProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<RenderProgressEvent>("render://progress", (event) => cb(event.payload));
}

export async function onRenderDone(cb: (event: RenderProgressEvent) => void): Promise<UnlistenFn> {
  return listen<RenderProgressEvent>("render://done", (event) => cb(event.payload));
}

export async function onRenderFailed(cb: (event: RenderProgressEvent) => void): Promise<UnlistenFn> {
  return listen<RenderProgressEvent>("render://failed", (event) => cb(event.payload));
}

function toRustTimelinePatch(patch: TimelinePatchDto): unknown {
  return {
    operations: patch.operations.map((operation) => {
      switch (operation.type) {
        case "add_track":
          return { type: operation.type, kind: operation.kind, name: operation.name };
        case "remove_track":
          return { type: operation.type, track_id: operation.trackId };
        case "reorder_track":
          return {
            type: operation.type,
            track_id: operation.trackId,
            new_index: operation.newIndex,
          };
        case "add_clip":
          return {
            type: operation.type,
            track_id: operation.trackId,
            asset_id: operation.assetId,
            timeline_start_ms: operation.timelineStartMs,
            source_in_ms: operation.sourceInMs,
            source_out_ms: operation.sourceOutMs,
            linked_group_id: operation.linkedGroupId,
            gain_db: operation.gainDb,
          };
        case "move_clip":
          return {
            type: operation.type,
            clip_id: operation.clipId,
            track_id: operation.trackId,
            timeline_start_ms: operation.timelineStartMs,
          };
        case "trim_clip":
          return {
            type: operation.type,
            clip_id: operation.clipId,
            source_in_ms: operation.sourceInMs,
            source_out_ms: operation.sourceOutMs,
          };
        case "split_clip":
          return {
            type: operation.type,
            clip_id: operation.clipId,
            at_timeline_ms: operation.atTimelineMs,
          };
        case "delete_clip":
          return { type: operation.type, clip_id: operation.clipId };
        default:
          return operation;
      }
    }),
  };
}
