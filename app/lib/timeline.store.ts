import fs from "fs";
import path from "path";
import type { MediaBinItem, TimelineState } from "~/components/timeline/types";
import type { ClipTranscriptsMap } from "~/components/media/captions.types";
import {
  ensureLocalStorageDirs,
  listProjectMediaFiles,
  PROJECT_STATE_DIR,
  sanitizeId,
} from "~/lib/local-storage";
import {
  buildMediaUrl,
  deterministicMediaBinIdFromStorageKey,
  inferMediaTypeFromFilename,
  isFileBackedMediaType,
  normalizeMediaBinItems,
  reconcileTimelineWithMediaBin,
  sanitizeTimelineForPersistence,
} from "~/lib/media-persistence";

const TIMELINE_DIR = process.env.TIMELINE_DIR || PROJECT_STATE_DIR;
const DEFAULT_TIMELINE_WIDTH = 2000;
const DEFAULT_ZOOM_LEVEL = 1;

function ensureDir(): void {
  ensureLocalStorageDirs();
  if (!fs.existsSync(TIMELINE_DIR)) {
    fs.mkdirSync(TIMELINE_DIR, { recursive: true });
  }
}

function getFilePath(projectId: string): string {
  ensureDir();
  const sanitizedId = sanitizeId(projectId);
  const filePath = path.resolve(TIMELINE_DIR, `${sanitizedId}.json`);
  if (!filePath.startsWith(path.resolve(TIMELINE_DIR))) {
    throw new Error("Invalid path");
  }
  return filePath;
}

export type ProjectEditorState = {
  zoomLevel: number;
  timelineWidth: number;
};

export type ProjectStateFile = {
  timeline: TimelineState;
  mediaBinItems: MediaBinItem[];
  // Legacy compatibility field that we continue to emit.
  textBinItems: MediaBinItem[];
  clipTranscripts: ClipTranscriptsMap;
  editorState: ProjectEditorState;
};

type LegacyProjectStateEnvelope = {
  timeline?: TimelineState;
  mediaBinItems?: MediaBinItem[];
  textBinItems?: MediaBinItem[];
  clipTranscripts?: ClipTranscriptsMap;
  editorState?: Partial<ProjectEditorState>;
};

function defaultTimeline(): TimelineState {
  return {
    tracks: [
      { id: "track-1", scrubbers: [], transitions: [] },
      { id: "track-2", scrubbers: [], transitions: [] },
      { id: "track-3", scrubbers: [], transitions: [] },
      { id: "track-4", scrubbers: [], transitions: [] },
    ],
  };
}

function defaultEditorState(): ProjectEditorState {
  return {
    zoomLevel: DEFAULT_ZOOM_LEVEL,
    timelineWidth: DEFAULT_TIMELINE_WIDTH,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTimeline(value: unknown): TimelineState {
  if (isRecord(value) && Array.isArray(value.tracks)) {
    return value as unknown as TimelineState;
  }
  return defaultTimeline();
}

function normalizeClipTranscripts(value: unknown): ClipTranscriptsMap {
  if (isRecord(value)) {
    return value as ClipTranscriptsMap;
  }
  return {};
}

function normalizeEditorState(value: unknown): ProjectEditorState {
  if (!isRecord(value)) return defaultEditorState();
  const rawZoom = Number(value.zoomLevel);
  const rawWidth = Number(value.timelineWidth);
  return {
    zoomLevel: Number.isFinite(rawZoom) && rawZoom > 0 ? rawZoom : DEFAULT_ZOOM_LEVEL,
    timelineWidth:
      Number.isFinite(rawWidth) && rawWidth > 0
        ? Math.round(rawWidth)
        : DEFAULT_TIMELINE_WIDTH,
  };
}

function toDiskMediaItems(projectId: string): MediaBinItem[] {
  const files = listProjectMediaFiles(projectId);
  const discovered: MediaBinItem[] = [];
  for (const file of files) {
    const mediaType = inferMediaTypeFromFilename(file.name);
    if (!mediaType) continue;
    const storageKey = file.storageKey;
    discovered.push({
      id: deterministicMediaBinIdFromStorageKey(storageKey),
      name: file.name,
      mediaType,
      mediaUrlLocal: null,
      mediaUrlRemote: buildMediaUrl(storageKey),
      storageKey,
      durationInSeconds: 0,
      media_width: 0,
      media_height: 0,
      text: null,
      isUploading: false,
      uploadProgress: null,
      left_transition_id: null,
      right_transition_id: null,
      groupped_scrubbers: null,
    });
  }
  return discovered;
}

function mergeMediaBinItems(
  savedMediaBinItems: MediaBinItem[],
  discoveredMediaItems: MediaBinItem[]
): MediaBinItem[] {
  const normalizedSaved = normalizeMediaBinItems(savedMediaBinItems);
  const discoveredByStorageKey = new Map<string, MediaBinItem>();
  for (const item of discoveredMediaItems) {
    if (!item.storageKey) continue;
    discoveredByStorageKey.set(item.storageKey, item);
  }

  const seenStorageKeys = new Set<string>();
  const merged: MediaBinItem[] = [];

  for (const item of normalizedSaved) {
    if (!isFileBackedMediaType(item.mediaType)) {
      merged.push(item);
      continue;
    }
    const storageKey = item.storageKey;
    if (!storageKey) continue;
    if (!discoveredByStorageKey.has(storageKey)) {
      // Skip stale file references.
      continue;
    }
    seenStorageKeys.add(storageKey);
    merged.push(item);
  }

  for (const discovered of discoveredMediaItems) {
    const storageKey = discovered.storageKey;
    if (!storageKey || seenStorageKeys.has(storageKey)) continue;
    merged.push(discovered);
  }

  return normalizeMediaBinItems(merged);
}

function makeProjectState(
  timeline: TimelineState,
  mediaBinItems: MediaBinItem[],
  clipTranscripts: ClipTranscriptsMap,
  editorState: ProjectEditorState
): ProjectStateFile {
  const normalizedMediaBinItems = normalizeMediaBinItems(mediaBinItems);
  const normalizedTimeline = reconcileTimelineWithMediaBin(
    timeline,
    normalizedMediaBinItems
  );
  return {
    timeline: normalizedTimeline,
    mediaBinItems: normalizedMediaBinItems,
    textBinItems: normalizedMediaBinItems.filter((item) => item.mediaType === "text"),
    clipTranscripts: normalizeClipTranscripts(clipTranscripts),
    editorState: normalizeEditorState(editorState),
  };
}

export async function loadProjectState(
  projectId: string
): Promise<ProjectStateFile> {
  const discoveredMediaItems = toDiskMediaItems(projectId);
  const file = getFilePath(projectId);
  try {
    const raw = await fs.promises.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as LegacyProjectStateEnvelope | TimelineState;
    const envelope = isRecord(parsed) ? (parsed as LegacyProjectStateEnvelope) : null;
    const hasEnvelope =
      Boolean(envelope) &&
      ("timeline" in (envelope as Record<string, unknown>) ||
        "mediaBinItems" in (envelope as Record<string, unknown>) ||
        "textBinItems" in (envelope as Record<string, unknown>) ||
        "clipTranscripts" in (envelope as Record<string, unknown>) ||
        "editorState" in (envelope as Record<string, unknown>));

    const timelineRaw = hasEnvelope ? envelope?.timeline : parsed;
    const mediaRaw = hasEnvelope
      ? Array.isArray(envelope?.mediaBinItems)
        ? envelope?.mediaBinItems
        : Array.isArray(envelope?.textBinItems)
          ? envelope?.textBinItems
          : []
      : [];

    const mergedMediaBinItems = mergeMediaBinItems(
      Array.isArray(mediaRaw) ? mediaRaw : [],
      discoveredMediaItems
    );

    return makeProjectState(
      normalizeTimeline(timelineRaw),
      mergedMediaBinItems,
      hasEnvelope ? normalizeClipTranscripts(envelope?.clipTranscripts) : {},
      hasEnvelope ? normalizeEditorState(envelope?.editorState) : defaultEditorState()
    );
  } catch {
    return makeProjectState(
      defaultTimeline(),
      discoveredMediaItems,
      {},
      defaultEditorState()
    );
  }
}

export async function saveProjectState(
  projectId: string,
  state: ProjectStateFile
): Promise<void> {
  const file = getFilePath(projectId);
  const providedMediaBinItems = Array.isArray(state.mediaBinItems)
    ? state.mediaBinItems
    : Array.isArray(state.textBinItems)
      ? state.textBinItems
      : [];
  const normalizedMediaBinItems = normalizeMediaBinItems(providedMediaBinItems);
  const normalizedTimeline = sanitizeTimelineForPersistence(
    normalizeTimeline(state.timeline),
    normalizedMediaBinItems
  );

  const payload = {
    timeline: normalizedTimeline,
    mediaBinItems: normalizedMediaBinItems,
    textBinItems: normalizedMediaBinItems.filter((item) => item.mediaType === "text"),
    clipTranscripts: normalizeClipTranscripts(state.clipTranscripts),
    editorState: normalizeEditorState(state.editorState),
  };

  await fs.promises.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
}

// Backwards-compatible helpers
export async function loadTimeline(projectId: string): Promise<TimelineState> {
  const state = await loadProjectState(projectId);
  return state.timeline;
}

export async function saveTimeline(
  projectId: string,
  timeline: TimelineState
): Promise<void> {
  const prev = await loadProjectState(projectId);
  await saveProjectState(projectId, {
    timeline,
    mediaBinItems: prev.mediaBinItems,
    textBinItems: prev.textBinItems,
    clipTranscripts: prev.clipTranscripts,
    editorState: prev.editorState,
  });
}
