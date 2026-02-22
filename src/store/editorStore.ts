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
  TrackKind,
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
  timelineSaveJson,
} from "../lib/ipc";
import { undoManager } from "./undoManager";

type EditorState = {
  currentProject?: ProjectSummary;
  recentProjects: ProjectSummary[];
  assets: MediaAsset[];
  timeline?: TimelineDto;
  selectedTrackId?: string;
  selectedClipId?: string;
  selectedClipIds: string[];
  playheadMs: number;
  zoomPxPerSec: number;
  renderJob?: RenderJobDto;
  loading: boolean;
  statusMessage?: string;
  errorMessage?: string;
  importProgressByAssetId: Record<string, number>;
  isPlaying: boolean;
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
  toggleClipSelection: (clipId: string, additive: boolean) => void;
  setSelectedTrack: (trackId?: string) => void;
  groupSelectedClips: () => Promise<void>;
  ungroupClip: (clipId: string) => Promise<void>;
  deleteSelectedClips: () => Promise<void>;
  updateImportProgress: (assetId: string, progress: number) => void;
  clearError: () => void;
  closeProject: () => void;
  togglePlayback: () => void;
  deleteSelectedClip: () => Promise<void>;
  splitAtPlayhead: () => Promise<void>;
  addTrack: (kind: TrackKind) => Promise<void>;
  removeTrack: (trackId: string) => Promise<void>;
  startRender: (settings: RenderSettingsDto) => Promise<void>;
  pollRenderStatus: () => Promise<void>;
  cancelRender: () => Promise<void>;
  addTextClip: (trackId: string, timelineStartMs: number, content: string) => Promise<void>;
  updateTextOverlay: (clipId: string, updates: Record<string, unknown>) => Promise<void>;
  addTransition: (trackId: string, fromClipId: string, toClipId: string, transitionType: string, durationMs: number) => Promise<void>;
  deleteTransition: (transitionId: string) => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
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

function reconcileTimelineSelection(
  timeline: TimelineDto,
  selectedTrackId?: string,
  selectedClipId?: string,
): { selectedTrackId?: string; selectedClipId?: string } {
  const nextSelectedClipId = selectedClipId && timeline.clips.some((clip) => clip.id === selectedClipId)
    ? selectedClipId
    : undefined;

  let nextSelectedTrackId = selectedTrackId && timeline.tracks.some((track) => track.id === selectedTrackId)
    ? selectedTrackId
    : undefined;

  if (!nextSelectedTrackId && nextSelectedClipId) {
    const selectedClip = timeline.clips.find((clip) => clip.id === nextSelectedClipId);
    if (selectedClip && timeline.tracks.some((track) => track.id === selectedClip.trackId)) {
      nextSelectedTrackId = selectedClip.trackId;
    }
  }

  if (!nextSelectedTrackId) {
    nextSelectedTrackId = timeline.tracks[0]?.id;
  }

  return {
    selectedTrackId: nextSelectedTrackId,
    selectedClipId: nextSelectedClipId,
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  recentProjects: [],
  assets: [],
  selectedClipIds: [],
  playheadMs: 0,
  zoomPxPerSec: 100,
  loading: false,
  importProgressByAssetId: {},
  isPlaying: false,
  canUndo: false,
  canRedo: false,

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
      const selection = reconcileTimelineSelection(
        timeline,
        get().selectedTrackId,
        get().selectedClipId,
      );
      set({ timeline, ...selection });
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    }
  },

  applyTimelinePatch: async (operations: TimelineOperation[]) => {
    const currentProject = get().currentProject;
    if (!currentProject || operations.length === 0) return;

    // Snapshot current timeline for undo before applying
    const prevTimeline = get().timeline;
    if (prevTimeline) {
      undoManager.push(prevTimeline);
    }

    try {
      const timeline = await timelineApplyPatch(currentProject.id, { operations });
      const selection = reconcileTimelineSelection(
        timeline,
        get().selectedTrackId,
        get().selectedClipId,
      );
      const validIds = new Set(timeline.clips.map((c) => c.id));
      const nextSelectedClipIds = get().selectedClipIds.filter((id) => validIds.has(id));
      set({ timeline, ...selection, selectedClipIds: nextSelectedClipIds, errorMessage: undefined, canUndo: undoManager.canUndo, canRedo: undoManager.canRedo });
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
  setSelectedClip: (selectedClipId) => set({ selectedClipId, selectedClipIds: selectedClipId ? [selectedClipId] : [] }),
  toggleClipSelection: (clipId: string, additive: boolean) => {
    const current = get().selectedClipIds;
    if (additive) {
      const next = current.includes(clipId)
        ? current.filter((id) => id !== clipId)
        : [...current, clipId];
      set({ selectedClipIds: next, selectedClipId: next[next.length - 1] });
    } else {
      set({ selectedClipIds: [clipId], selectedClipId: clipId });
    }
  },
  setSelectedTrack: (selectedTrackId) => set({ selectedTrackId }),

  groupSelectedClips: async () => {
    const { selectedClipIds } = get();
    if (selectedClipIds.length < 2) return;
    const groupId = crypto.randomUUID();
    const ops: TimelineOperation[] = selectedClipIds.map((clipId) => ({
      type: "set_linked_group" as const,
      clipId,
      linkedGroupId: groupId,
    }));
    await get().applyTimelinePatch(ops);
  },

  ungroupClip: async (clipId: string) => {
    await get().applyTimelinePatch([
      { type: "set_linked_group", clipId, linkedGroupId: undefined },
    ]);
  },

  deleteSelectedClips: async () => {
    const { selectedClipIds } = get();
    if (selectedClipIds.length === 0) return;
    const ops: TimelineOperation[] = selectedClipIds.map((clipId) => ({
      type: "delete_clip" as const,
      clipId,
    }));
    await get().applyTimelinePatch(ops);
    set({ selectedClipIds: [], selectedClipId: undefined });
  },
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
    undoManager.clear();
    useEditorStore.setState({
      currentProject: undefined,
      assets: [],
      timeline: undefined,
      selectedTrackId: undefined,
      selectedClipId: undefined,
      selectedClipIds: [],
      playheadMs: 0,
      renderJob: undefined,
      importProgressByAssetId: {},
      isPlaying: false,
      errorMessage: undefined,
      statusMessage: undefined,
      canUndo: false,
      canRedo: false,
    });
  },

  togglePlayback: () => {
    set((state) => ({ isPlaying: !state.isPlaying }));
  },

  deleteSelectedClip: async () => {
    const { selectedClipId } = get();
    if (!selectedClipId) return;
    await get().applyTimelinePatch([{ type: "delete_clip", clipId: selectedClipId }]);
    set({ selectedClipId: undefined });
  },

  splitAtPlayhead: async () => {
    const { selectedClipId, playheadMs, timeline } = get();
    if (!selectedClipId || !timeline) return;
    const clip = timeline.clips.find((c) => c.id === selectedClipId);
    if (!clip) return;
    const clipEnd = clip.timelineStartMs + (clip.sourceOutMs - clip.sourceInMs);
    if (playheadMs > clip.timelineStartMs && playheadMs < clipEnd) {
      await get().applyTimelinePatch([
        { type: "split_clip", clipId: clip.id, atTimelineMs: playheadMs },
      ]);
    }
  },

  addTextClip: async (trackId: string, timelineStartMs: number, content: string) => {
    await get().applyTimelinePatch([
      {
        type: "add_text_clip",
        trackId,
        timelineStartMs,
        durationMs: 3000,
        content,
      },
    ]);
  },

  updateTextOverlay: async (clipId: string, updates: Record<string, unknown>) => {
    await get().applyTimelinePatch([
      {
        type: "update_text_overlay",
        clipId,
        ...updates,
      } as TimelineOperation,
    ]);
  },

  addTransition: async (trackId: string, fromClipId: string, toClipId: string, transitionType: string, durationMs: number) => {
    await get().applyTimelinePatch([
      {
        type: "add_transition",
        trackId,
        fromClipId,
        toClipId,
        transitionType,
        durationMs,
      },
    ]);
  },

  deleteTransition: async (transitionId: string) => {
    await get().applyTimelinePatch([
      { type: "delete_transition", transitionId },
    ]);
  },

  addTrack: async (kind: TrackKind) => {
    const timeline = get().timeline;
    const trackCountOfKind = timeline?.tracks.filter((track) => track.kind === kind).length ?? 0;
    const name = `${kind === "audio" ? "Audio" : "Video"} ${trackCountOfKind + 1}`;
    await get().applyTimelinePatch([{ type: "add_track", kind, name }]);
  },

  removeTrack: async (trackId: string) => {
    await get().applyTimelinePatch([{ type: "remove_track", trackId }]);
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

  undo: async () => {
    const currentProject = get().currentProject;
    if (!currentProject) return;

    const snapshot = undoManager.undo();
    if (!snapshot) return;

    try {
      await timelineSaveJson(currentProject.id, JSON.stringify(snapshot));
      await get().refreshTimeline();
      set({ canUndo: undoManager.canUndo, canRedo: undoManager.canRedo });
    } catch (error) {
      set({ errorMessage: normalizeError(error) });
    }
  },

  redo: async () => {
    const currentProject = get().currentProject;
    if (!currentProject) return;

    const snapshot = undoManager.redo();
    if (!snapshot) return;

    try {
      await timelineSaveJson(currentProject.id, JSON.stringify(snapshot));
      await get().refreshTimeline();
      set({ canUndo: undoManager.canUndo, canRedo: undoManager.canRedo });
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
    selectedClipIds: [],
    playheadMs: 0,
    errorMessage: undefined,
    renderJob: undefined,
    importProgressByAssetId: {},
    isPlaying: false,
  });
}

export function getSelectedClip(state: Pick<EditorState, "timeline" | "selectedClipId">): Clip | undefined {
  if (!state.timeline || !state.selectedClipId) return undefined;
  return state.timeline.clips.find((clip) => clip.id === state.selectedClipId);
}
