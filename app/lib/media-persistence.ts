import type {
  MediaBinItem,
  ScrubberState,
  TimelineState,
} from "~/components/timeline/types";

const DEFAULT_RENDER_SERVER_BASE = "http://127.0.0.1:8000";

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "webm",
  "mkv",
  "avi",
  "flv",
  "wmv",
  "m4v",
]);
const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "aac",
  "ogg",
  "flac",
  "m4a",
  "opus",
  "aiff",
  "aif",
]);
const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "bmp",
  "webp",
  "tiff",
  "svg",
  "heic",
  "heif",
]);

type FileBackedMediaType = "video" | "image" | "audio";
type MediaLookup = {
  byId: Map<string, MediaBinItem>;
  byStorageKey: Map<string, MediaBinItem>;
};

function readRenderServerBaseUrl(): string {
  if (
    typeof process !== "undefined" &&
    process.env &&
    typeof process.env.VIDERE_RENDER_SERVER_URL === "string" &&
    process.env.VIDERE_RENDER_SERVER_URL.trim()
  ) {
    return process.env.VIDERE_RENDER_SERVER_URL.trim();
  }
  return DEFAULT_RENDER_SERVER_BASE;
}

function toEncodedStoragePath(storageKey: string): string {
  return storageKey
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function toDecodedStoragePath(value: string): string {
  return value
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

function resolveStorageKey(
  storageKey: string | null | undefined,
  mediaUrlRemote: string | null | undefined
): string | null {
  const fromField =
    typeof storageKey === "string" && storageKey.trim().length > 0
      ? toDecodedStoragePath(storageKey.trim())
      : null;
  if (fromField) return fromField;
  return extractStorageKey(mediaUrlRemote ?? null);
}

function buildMediaLookup(mediaBinItems: MediaBinItem[]): MediaLookup {
  const byId = new Map<string, MediaBinItem>();
  const byStorageKey = new Map<string, MediaBinItem>();

  for (const item of mediaBinItems) {
    byId.set(item.id, item);
    if (!isFileBackedMediaType(item.mediaType)) {
      continue;
    }
    const storageKey = resolveStorageKey(item.storageKey, item.mediaUrlRemote);
    if (!storageKey) continue;
    byStorageKey.set(storageKey, item);
  }

  return { byId, byStorageKey };
}

export function isFileBackedMediaType(
  mediaType: MediaBinItem["mediaType"] | ScrubberState["mediaType"]
): mediaType is FileBackedMediaType {
  return mediaType === "video" || mediaType === "image" || mediaType === "audio";
}

export function inferMediaTypeFromFilename(
  filename: string
): FileBackedMediaType | null {
  const lower = String(filename || "").toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  if (!ext) return null;
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return null;
}

export function extractStorageKey(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  const raw = String(mediaUrl).trim();
  if (!raw || raw.startsWith("blob:")) return null;

  try {
    const parsed = new URL(raw, DEFAULT_RENDER_SERVER_BASE);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const mediaIndex = pathParts.findIndex((part) => part === "media");
    const keyParts =
      mediaIndex >= 0 ? pathParts.slice(mediaIndex + 1) : pathParts;
    if (keyParts.length === 0) return null;
    return toDecodedStoragePath(keyParts.join("/"));
  } catch {
    // Fallback: assume raw string itself is a storage key.
    return toDecodedStoragePath(raw.replace(/^\/+/, ""));
  }
}

export function buildMediaUrl(storageKey: string | null): string | null {
  if (!storageKey) return null;
  const clean = toDecodedStoragePath(storageKey);
  if (!clean) return null;
  const base = readRenderServerBaseUrl();
  return `${base}/media/${toEncodedStoragePath(clean)}`;
}

export function deterministicMediaBinIdFromStorageKey(storageKey: string): string {
  const source = toDecodedStoragePath(storageKey);
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash << 5) - hash + source.charCodeAt(i);
    hash |= 0;
  }
  const hashPart = Math.abs(hash).toString(36);
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `media-${hashPart}-${slug || "asset"}`;
}

function normalizeScrubber(
  scrubber: ScrubberState,
  lookup?: MediaLookup
): ScrubberState {
  const grouped =
    scrubber.groupped_scrubbers?.map((nested) =>
      normalizeScrubber(nested, lookup)
    ) ?? null;

  if (!isFileBackedMediaType(scrubber.mediaType)) {
    return {
      ...scrubber,
      storageKey: null,
      mediaUrlLocal: null,
      mediaUrlRemote: null,
      isUploading: false,
      uploadProgress: null,
      groupped_scrubbers: grouped,
    };
  }

  const fromSourceId = scrubber.sourceMediaBinId
    ? lookup?.byId.get(scrubber.sourceMediaBinId) ?? null
    : null;
  const storageKey =
    resolveStorageKey(scrubber.storageKey, scrubber.mediaUrlRemote) ??
    resolveStorageKey(fromSourceId?.storageKey, fromSourceId?.mediaUrlRemote);
  const fromStorageKey = storageKey ? lookup?.byStorageKey.get(storageKey) : null;
  const source = fromStorageKey ?? fromSourceId ?? null;

  const resolvedSourceMediaBinId =
    scrubber.sourceMediaBinId || source?.id || scrubber.id;

  return {
    ...scrubber,
    storageKey,
    sourceMediaBinId: resolvedSourceMediaBinId,
    mediaUrlLocal: null,
    mediaUrlRemote: buildMediaUrl(storageKey) ?? source?.mediaUrlRemote ?? null,
    media_width:
      scrubber.media_width === 0
        ? (source?.media_width ?? scrubber.media_width)
        : scrubber.media_width,
    media_height:
      scrubber.media_height === 0
        ? (source?.media_height ?? scrubber.media_height)
        : scrubber.media_height,
    isUploading: false,
    uploadProgress: null,
    groupped_scrubbers: grouped,
  };
}

export function normalizeMediaBinItem(item: MediaBinItem): MediaBinItem {
  const grouped =
    item.groupped_scrubbers?.map((scrubber) => normalizeScrubber(scrubber)) ??
    null;

  if (!isFileBackedMediaType(item.mediaType)) {
    return {
      ...item,
      storageKey: null,
      mediaUrlLocal: null,
      mediaUrlRemote: null,
      isUploading: false,
      uploadProgress: null,
      groupped_scrubbers: grouped,
    };
  }

  const storageKey = resolveStorageKey(item.storageKey, item.mediaUrlRemote);
  return {
    ...item,
    storageKey,
    mediaUrlLocal: null,
    mediaUrlRemote: buildMediaUrl(storageKey),
    isUploading: false,
    uploadProgress: null,
    groupped_scrubbers: grouped,
  };
}

export function normalizeMediaBinItems(mediaBinItems: MediaBinItem[]): MediaBinItem[] {
  return mediaBinItems.map((item) => normalizeMediaBinItem(item));
}

export function reconcileTimelineWithMediaBin(
  timeline: TimelineState,
  mediaBinItems: MediaBinItem[]
): TimelineState {
  const normalizedMedia = normalizeMediaBinItems(mediaBinItems);
  const lookup = buildMediaLookup(normalizedMedia);

  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      scrubbers: track.scrubbers.map((scrubber) =>
        normalizeScrubber(scrubber, lookup)
      ),
    })),
  };
}

export function sanitizeTimelineForPersistence(
  timeline: TimelineState,
  mediaBinItems: MediaBinItem[]
): TimelineState {
  return reconcileTimelineWithMediaBin(timeline, mediaBinItems);
}

export function sanitizeMediaBinItemsForPersistence(
  mediaBinItems: MediaBinItem[]
): MediaBinItem[] {
  return normalizeMediaBinItems(mediaBinItems);
}
