import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  analysisEnqueueStub,
  mediaImport,
  mediaRemove,
  projectCreate,
  projectDelete,
  projectListRecent,
  projectOpen,
  projectOpenById,
  projectRename,
  projectSaveState,
  projectStorageStats,
  renderCapabilities,
  renderCancel,
  renderStart,
  renderStatus,
  type ProjectStateDto,
} from "../../lib/ipc";
import type {
  AnalysisJob,
  KlypProjectState,
  MediaBinItem,
  ProjectCard,
  ProjectState,
  RenderJob,
} from "../types/editor";

function defaultTimelineState() {
  return {
    tracks: [
      { id: "track-1", scrubbers: [], transitions: [] },
      { id: "track-2", scrubbers: [], transitions: [] },
      { id: "track-3", scrubbers: [], transitions: [] },
      { id: "track-4", scrubbers: [], transitions: [] },
    ],
  };
}

function parseProjectState(raw: unknown): KlypProjectState {
  if (!raw || typeof raw !== "object") {
    return { timeline: defaultTimelineState(), textBinItems: [] };
  }
  const obj = raw as { timeline?: unknown; textBinItems?: unknown };
  const timeline =
    obj.timeline && typeof obj.timeline === "object"
      ? (obj.timeline as KlypProjectState["timeline"])
      : defaultTimelineState();
  const textBinItems = Array.isArray(obj.textBinItems) ? (obj.textBinItems as MediaBinItem[]) : [];
  return { timeline, textBinItems };
}

function assetToMediaBinItem(asset: ProjectState["assets"][number]): MediaBinItem {
  const mediaType = asset.kind === "image" ? "image" : asset.kind === "audio" ? "audio" : "video";
  const remote = convertFileSrc(asset.managedPath);
  return {
    id: asset.id,
    name: asset.fileName,
    mediaType,
    mediaUrlLocal: remote,
    mediaUrlRemote: null,
    durationInSeconds: Math.max((asset.durationMs ?? 0) / 1000, 0),
    media_width: asset.width ?? 0,
    media_height: asset.height ?? 0,
    text: null,
    groupped_scrubbers: null,
    left_transition_id: null,
    right_transition_id: null,
    uploadProgress: null,
    isUploading: false,
  };
}

function fromRecentProject(summary: {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}): ProjectCard {
  return {
    id: summary.id,
    name: summary.name,
    rootPath: summary.rootPath,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

function normalizeProjectState(raw: Awaited<ReturnType<typeof projectOpenById>>): ProjectState {
  return {
    summary: fromRecentProject(raw.summary),
    timeline:
      raw.timeline && typeof raw.timeline === "object"
        ? (raw.timeline as ProjectState["timeline"])
        : defaultTimelineState(),
    textBinItems: Array.isArray(raw.textBinItems) ? (raw.textBinItems as MediaBinItem[]) : [],
    assets: raw.assets.map((asset) => ({
      id: asset.id,
      fileName: asset.fileName,
      kind: asset.kind,
      managedPath: asset.managedPath,
      durationMs: asset.durationMs ?? undefined,
      width: asset.width ?? undefined,
      height: asset.height ?? undefined,
    })),
  };
}

export async function listProjects(): Promise<ProjectCard[]> {
  const projects = await projectListRecent();
  return projects.map(fromRecentProject);
}

export async function createProject(name: string, location: string): Promise<ProjectState> {
  const summary = await projectCreate(name, location);
  const state = await projectOpenById(summary.id);
  return normalizeProjectState(state);
}

export async function openProjectByRoot(rootPath: string): Promise<ProjectState> {
  const opened = await projectOpen(rootPath);
  const state = await projectOpenById(opened.summary.id);
  return normalizeProjectState(state);
}

export async function openProjectById(projectId: string): Promise<ProjectState> {
  const state = await projectOpenById(projectId);
  return normalizeProjectState(state);
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  await projectRename(projectId, name);
}

export async function deleteProject(projectId: string): Promise<void> {
  await projectDelete(projectId);
}

export async function saveProjectState(projectId: string, state: KlypProjectState): Promise<void> {
  const payload: ProjectStateDto = {
    timeline: state.timeline,
    textBinItems: state.textBinItems,
  };
  await projectSaveState(projectId, payload);
}

export async function importMedia(projectId: string): Promise<MediaBinItem[]> {
  const selected = await open({
    title: "Import media files",
    multiple: true,
    directory: false,
    filters: [
      { name: "Media", extensions: ["mp4", "mov", "mkv", "webm", "avi", "mp3", "wav", "aac", "m4a", "jpg", "jpeg", "png", "webp", "gif"] },
    ],
  });
  if (!selected) return [];
  const sourcePaths = Array.isArray(selected) ? selected : [selected];
  if (sourcePaths.length === 0) return [];
  const imported = await mediaImport(projectId, sourcePaths);
  return imported.imported.map((asset) =>
    assetToMediaBinItem({
      id: asset.id,
      fileName: asset.fileName,
      kind: asset.kind,
      managedPath: asset.managedPath,
      durationMs: asset.durationMs ?? undefined,
      width: asset.width ?? undefined,
      height: asset.height ?? undefined,
    }),
  );
}

export async function removeMedia(projectId: string, assetId: string): Promise<void> {
  await mediaRemove(projectId, assetId);
}

export async function startRender(
  projectId: string,
  settings: { outputName?: string; width?: number; height?: number; fps?: number },
): Promise<RenderJob> {
  const result = await renderStart(projectId, settings);
  return {
    id: result.id,
    status: result.status,
    progress: result.progress,
    outputPath: result.outputPath,
    error: result.error,
  };
}

export async function getRenderStatus(projectId: string, jobId: string): Promise<RenderJob> {
  const result = await renderStatus(projectId, jobId);
  return {
    id: result.id,
    status: result.status,
    progress: result.progress,
    outputPath: result.outputPath,
    error: result.error,
  };
}

export async function cancelRender(projectId: string, jobId: string): Promise<void> {
  await renderCancel(projectId, jobId);
}

export async function enqueueAnalysis(projectId: string, prompt: string): Promise<AnalysisJob> {
  const result = await analysisEnqueueStub(projectId, prompt);
  return {
    id: result.id,
    jobKind: result.jobKind,
    status: result.status,
    message: result.message,
  };
}

export async function getStorageStats(projectId: string): Promise<{ usedBytes: number; limitBytes: number }> {
  return projectStorageStats(projectId);
}

export async function getRenderCapabilities(): Promise<{ remotionEnabled: boolean; reason?: string }> {
  return renderCapabilities();
}

export { parseProjectState, defaultTimelineState };
