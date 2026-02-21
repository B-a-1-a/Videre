import { create } from "zustand";
import type {
  Clip,
  MediaAsset,
  ProjectSnapshot,
  ProjectSummary,
  RenderJobDto,
  RenderSettingsDto,
  TimelineDto,
  TimelineOperation,
} from "../types/domain";
import {
  mediaImport,
  mediaRemove,
  projectCreate,
  projectDelete,
  projectListRecent,
  projectOpen,
  projectSave,
  renderCancel,
  renderStart,
  renderStatus,
  timelineApplyPatch,
  timelineGet,
  timelineGetJson,
  timelineSaveJson,
} from "../lib/ipc";

type EditorState = {
  currentProject?: ProjectSummary;
  recentProjects: ProjectSummary[];
  assets: MediaAsset[];
  timeline?: TimelineDto;
  selectedTrackId?: string;
  selectedClipId?: string;
  playheadMs: number;
  zoomPxPerSec: number;
  renderJob?: RenderJobDto;
  loading: boolean;
  statusMessage?: string;
  errorMessage?: string;
  importProgressByAssetId: Record<string, number>;
  twickTimelineJson: string | null;
  twickAddElement: ((element: unknown) => Promise<void>) | null;
  setTwickAddElement: (fn: ((element: unknown) => Promise<void>) | null) => void;
  twickGetTimelineData: (() => unknown) | null;
  setTwickGetTimelineData: (fn: (() => unknown) | null) => void;
  loadTwickTimeline: (projectId: string) => Promise<void>;
  saveTwickTimeline: (projectId: string, json: string) => Promise<void>;
  loadRecentProjects: () => Promise<void>;
  createProject: (name: string, location: string) => Promise<void>;
  openProject: (projectRoot: string) => Promise<void>;
  openProjectBySummary: (summary: ProjectSummary) => Promise<void>;
  deleteProject: (summary: ProjectSummary) => Promise<void>;
  saveProject: () => Promise<void>;
  importMedia: (sourcePaths: string[]) => Promise<void>;
  removeAsset: (assetId: string) => Promise<void>;
  refreshTimeline: () => Promise<void>;
  applyTimelinePatch: (operations: TimelineOperation[]) => Promise<void>;
  addClipFromAsset: (assetId: string, trackId: string, timelineStartMs: number) => Promise<void>;
  setPlayheadMs: (playheadMs: number) => void;
  setZoomPxPerSec: (zoomPxPerSec: number) => void;
  setSelectedClip: (clipId?: string) => void;
  setSelectedTrack: (trackId?: string) => void;
  updateImportProgress: (assetId: string, progress: number) => void;
  clearError: () => void;
  closeProject: () => void;
  startRender: (settings: RenderSettingsDto) => Promise<void>;
  pollRenderStatus: () => Promise<void>;
  cancelRender: () => Promise<void>;
};

function normalizeError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message);
  }
  return "Unknown error";
}

function findDefaultClipRange(asset?: MediaAsset): { sourceInMs: number; sourceOutMs: number } {
  const sourceInMs = 0;
  const duration = Math.max(asset?.durationMs ?? 3000, 250);
  return { sourceInMs, sourceOutMs: duration };
}

function upsertAssets(current: MediaAsset[], incoming: MediaAsset[]): MediaAsset[] {
  const map = new Map(current.map((asset) => [asset.id, asset]));
  for (const asset of incoming) {
    map.set(asset.id, asset);
  }
  return [...map.values()];
}

export const useEditorStore = create<EditorState>((set, get) => ({
  recentProjects: [],
  assets: [],
  playheadMs: 0,
  zoomPxPerSec: 100,
  loading: false,
  importProgressByAssetId: {},
  twickTimelineJson: null,
  twickAddElement: null,
  setTwickAddElement: (fn) => set({ twickAddElement: fn }),
  twickGetTimelineData: null,
  setTwickGetTimelineData: (fn) => set({ twickGetTimelineData: fn }),

  loadTwickTimeline: async (projectId: string) => {
    try {
      const twickTimelineJson = await timelineGetJson(projectId);
      set({ twickTimelineJson });
    } catch {
      // non-fatal: twick timeline may not exist yet for older projects
    }
  },

  saveTwickTimeline: async (projectId: string, json: string) => {
    try {
      await timelineSaveJson(projectId, json);
      set({ twickTimelineJson: json });
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    }
  },

  loadRecentProjects: async () => {
    try {
      const recentProjects = await projectListRecent();
      set({ recentProjects });
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    }
  },

  createProject: async (name: string, location: string) => {
    set({ loading: true, errorMessage: undefined, statusMessage: "Creating project..." });
    try {
      const summary = await projectCreate(name, location);
      const snapshot = await projectOpen(summary.rootPath);
      setSnapshot(snapshot);
      await get().loadRecentProjects();
      set({ statusMessage: `Project '${summary.name}' created.` });
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    } finally {
      set({ loading: false });
    }
  },

  openProject: async (projectRoot: string) => {
    set({ loading: true, errorMessage: undefined, statusMessage: "Opening project..." });
    try {
      const snapshot = await projectOpen(projectRoot);
      setSnapshot(snapshot);
      await get().loadTwickTimeline(snapshot.summary.id);
      await get().loadRecentProjects();
      set({ statusMessage: `Opened project '${snapshot.summary.name}'.` });
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    } finally {
      set({ loading: false });
    }
  },

  openProjectBySummary: async (summary: ProjectSummary) => {
    await get().openProject(summary.rootPath);
  },

  deleteProject: async (summary: ProjectSummary) => {
    set({ loading: true, errorMessage: undefined, statusMessage: `Deleting '${summary.name}'...` });
    try {
      await projectDelete(summary.id);
      const currentProject = get().currentProject;
      if (currentProject?.id === summary.id) {
        get().closeProject();
      }
      set({
        recentProjects: get().recentProjects.filter((project) => project.id !== summary.id),
        statusMessage: `Deleted project '${summary.name}'.`,
      });
      await get().loadRecentProjects();
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    } finally {
      set({ loading: false });
    }
  },

  saveProject: async () => {
    const currentProject = get().currentProject;
    if (!currentProject) return;

    try {
      const result = await projectSave(currentProject.id);
      set({ statusMessage: `Saved at ${new Date(result.savedAt).toLocaleTimeString()}` });
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    }
  },

  importMedia: async (sourcePaths: string[]) => {
    const currentProject = get().currentProject;
    if (!currentProject || sourcePaths.length === 0) return;

    set({ loading: true, errorMessage: undefined, statusMessage: "Importing media..." });
    try {
      const result = await mediaImport(currentProject.id, sourcePaths);
      const assets = upsertAssets(get().assets, result.imported);
      set({ assets, statusMessage: `Imported ${result.imported.length} assets.` });
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    } finally {
      set({ loading: false });
    }
  },

  removeAsset: async (assetId: string) => {
    const currentProject = get().currentProject;
    if (!currentProject) return;

    try {
      await mediaRemove(currentProject.id, assetId);
      set({ assets: get().assets.filter((asset) => asset.id !== assetId) });
      set({ statusMessage: "Asset removed." });
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    }
  },

  refreshTimeline: async () => {
    const currentProject = get().currentProject;
    if (!currentProject) return;

    try {
      const timeline = await timelineGet(currentProject.id);
      set({ timeline });
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    }
  },

  applyTimelinePatch: async (operations: TimelineOperation[]) => {
    const currentProject = get().currentProject;
    if (!currentProject || operations.length === 0) return;

    try {
      const timeline = await timelineApplyPatch(currentProject.id, { operations });
      set({ timeline, errorMessage: undefined });
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    }
  },

  addClipFromAsset: async (assetId: string, trackId: string, timelineStartMs: number) => {
    const asset = get().assets.find((candidate) => candidate.id === assetId);
    const range = findDefaultClipRange(asset);
    await get().applyTimelinePatch([
      {
        type: "add_clip",
        trackId,
        assetId,
        timelineStartMs,
        sourceInMs: range.sourceInMs,
        sourceOutMs: range.sourceOutMs,
      },
    ]);
  },

  setPlayheadMs: (playheadMs) => set({ playheadMs }),
  setZoomPxPerSec: (zoomPxPerSec) => set({ zoomPxPerSec }),
  setSelectedClip: (selectedClipId) => set({ selectedClipId }),
  setSelectedTrack: (selectedTrackId) => set({ selectedTrackId }),
  updateImportProgress: (assetId, progress) => {
    set((state) => ({
      importProgressByAssetId: {
        ...state.importProgressByAssetId,
        [assetId]: progress,
      },
    }));
  },

  clearError: () => set({ errorMessage: undefined }),

  closeProject: () => {
    useEditorStore.setState({
      currentProject: undefined,
      assets: [],
      timeline: undefined,
      selectedTrackId: undefined,
      selectedClipId: undefined,
      playheadMs: 0,
      renderJob: undefined,
      importProgressByAssetId: {},
      twickTimelineJson: null,
      errorMessage: undefined,
      statusMessage: undefined,
    });
  },

  startRender: async (settings) => {
    const currentProject = get().currentProject;
    if (!currentProject) return;

    set({ loading: true, errorMessage: undefined, statusMessage: "Starting render..." });
    try {
      const renderJob = await renderStart(currentProject.id, settings);
      set({ renderJob, statusMessage: "Render started." });
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    } finally {
      set({ loading: false });
    }
  },

  pollRenderStatus: async () => {
    const currentProject = get().currentProject;
    const renderJob = get().renderJob;
    if (!currentProject || !renderJob) return;

    try {
      const latest = await renderStatus(currentProject.id, renderJob.id);
      set({ renderJob: latest });
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    }
  },

  cancelRender: async () => {
    const currentProject = get().currentProject;
    const renderJob = get().renderJob;
    if (!currentProject || !renderJob) return;

    try {
      await renderCancel(currentProject.id, renderJob.id);
      set({ statusMessage: "Render cancellation requested." });
      await get().pollRenderStatus();
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    }
  },
}));

function setSnapshot(snapshot: ProjectSnapshot) {
  useEditorStore.setState({
    currentProject: snapshot.summary,
    assets: snapshot.assets,
    timeline: snapshot.timeline,
    selectedTrackId: snapshot.timeline.tracks[0]?.id,
    selectedClipId: undefined,
    playheadMs: 0,
    errorMessage: undefined,
    renderJob: undefined,
    importProgressByAssetId: {},
    twickTimelineJson: null,
  });
}

export function getSelectedClip(state: Pick<EditorState, "timeline" | "selectedClipId">): Clip | undefined {
  if (!state.timeline || !state.selectedClipId) return undefined;
  return state.timeline.clips.find((clip) => clip.id === state.selectedClipId);
}
