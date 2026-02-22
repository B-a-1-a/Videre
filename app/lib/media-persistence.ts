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
const DEFAULT_PLAYER_LEFT = 100;
const DEFAULT_PLAYER_TOP = 100;
const DEFAULT_VISUAL_PLAYER_WIDTH = 640;
const DEFAULT_VISUAL_PLAYER_HEIGHT = 360;
const DEFAULT_TEXT_FONT_SIZE = 48;
const DEFAULT_TEXT_PLAYER_WIDTH = 200;
const DEFAULT_TEXT_PLAYER_HEIGHT = 80;

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

function toPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function toFiniteOrDefault(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function inferTextLayout(
  text: ScrubberState["text"] | MediaBinItem["text"]
): { width: number; height: number } {
  const fontSize = toPositiveNumber(text?.fontSize) ?? DEFAULT_TEXT_FONT_SIZE;
  const textLength = Math.max(1, String(text?.textContent ?? "").trim().length);
  return {
    width: Math.max(
      DEFAULT_TEXT_PLAYER_WIDTH,
      Math.round(textLength * fontSize * 0.6)
    ),
    height: Math.max(DEFAULT_TEXT_PLAYER_HEIGHT, Math.round(fontSize * 1.5)),
  };
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
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
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
    if (scrubber.mediaType === "text") {
      const inferredTextLayout = inferTextLayout(scrubber.text);
      const normalizedMediaWidth =
        toPositiveNumber(scrubber.media_width) ?? inferredTextLayout.width;
      const normalizedMediaHeight =
        toPositiveNumber(scrubber.media_height) ?? inferredTextLayout.height;
      const normalizedPlayerWidth =
        toPositiveNumber(scrubber.width_player) ?? normalizedMediaWidth;
      const normalizedPlayerHeight =
        toPositiveNumber(scrubber.height_player) ?? normalizedMediaHeight;
      return {
        ...scrubber,
        storageKey: null,
        mediaUrlLocal: null,
        mediaUrlRemote: null,
        media_width: normalizedMediaWidth,
        media_height: normalizedMediaHeight,
        left_player: toFiniteOrDefault(scrubber.left_player, DEFAULT_PLAYER_LEFT),
        top_player: toFiniteOrDefault(scrubber.top_player, DEFAULT_PLAYER_TOP),
        width_player: normalizedPlayerWidth,
        height_player: normalizedPlayerHeight,
        isUploading: false,
        uploadProgress: null,
        groupped_scrubbers: grouped,
      };
    }

    return {
      ...scrubber,
      storageKey: null,
      mediaUrlLocal: null,
      mediaUrlRemote: null,
      media_width: toPositiveNumber(scrubber.media_width) ?? 0,
      media_height: toPositiveNumber(scrubber.media_height) ?? 0,
      left_player: toFiniteOrDefault(scrubber.left_player, DEFAULT_PLAYER_LEFT),
      top_player: toFiniteOrDefault(scrubber.top_player, DEFAULT_PLAYER_TOP),
      width_player: toPositiveNumber(scrubber.width_player) ?? 0,
      height_player: toPositiveNumber(scrubber.height_player) ?? 0,
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
    source?.id || scrubber.sourceMediaBinId || scrubber.id;
  const normalizedMediaWidth =
    toPositiveNumber(scrubber.media_width) ??
    toPositiveNumber(source?.media_width) ??
    toPositiveNumber(scrubber.width_player) ??
    (scrubber.mediaType === "audio" ? 0 : DEFAULT_VISUAL_PLAYER_WIDTH);
  const normalizedMediaHeight =
    toPositiveNumber(scrubber.media_height) ??
    toPositiveNumber(source?.media_height) ??
    toPositiveNumber(scrubber.height_player) ??
    (scrubber.mediaType === "audio" ? 0 : DEFAULT_VISUAL_PLAYER_HEIGHT);
  const normalizedPlayerWidth =
    scrubber.mediaType === "audio"
      ? 0
      : toPositiveNumber(scrubber.width_player) ??
        normalizedMediaWidth ??
        DEFAULT_VISUAL_PLAYER_WIDTH;
  const normalizedPlayerHeight =
    scrubber.mediaType === "audio"
      ? 0
      : toPositiveNumber(scrubber.height_player) ??
        normalizedMediaHeight ??
        DEFAULT_VISUAL_PLAYER_HEIGHT;
  const normalizedDurationInSeconds =
    toPositiveNumber(scrubber.durationInSeconds) ??
    toPositiveNumber(source?.durationInSeconds) ??
    scrubber.durationInSeconds;

  return {
    ...scrubber,
    storageKey,
    sourceMediaBinId: resolvedSourceMediaBinId,
    mediaUrlLocal: null,
    mediaUrlRemote: buildMediaUrl(storageKey) ?? source?.mediaUrlRemote ?? null,
    durationInSeconds: normalizedDurationInSeconds,
    media_width: normalizedMediaWidth,
    media_height: normalizedMediaHeight,
    left_player: toFiniteOrDefault(scrubber.left_player, DEFAULT_PLAYER_LEFT),
    top_player: toFiniteOrDefault(scrubber.top_player, DEFAULT_PLAYER_TOP),
    width_player: normalizedPlayerWidth,
    height_player: normalizedPlayerHeight,
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
    if (item.mediaType === "text") {
      const inferredTextLayout = inferTextLayout(item.text);
      return {
        ...item,
        storageKey: null,
        mediaUrlLocal: null,
        mediaUrlRemote: null,
        media_width:
          toPositiveNumber(item.media_width) ?? inferredTextLayout.width,
        media_height:
          toPositiveNumber(item.media_height) ?? inferredTextLayout.height,
        durationInSeconds: toPositiveNumber(item.durationInSeconds) ?? 0,
        isUploading: false,
        uploadProgress: null,
        groupped_scrubbers: grouped,
      };
    }

    return {
      ...item,
      storageKey: null,
      mediaUrlLocal: null,
      mediaUrlRemote: null,
      media_width: toPositiveNumber(item.media_width) ?? 0,
      media_height: toPositiveNumber(item.media_height) ?? 0,
      durationInSeconds: toPositiveNumber(item.durationInSeconds) ?? 0,
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
    media_width: toPositiveNumber(item.media_width) ?? 0,
    media_height: toPositiveNumber(item.media_height) ?? 0,
    durationInSeconds: toPositiveNumber(item.durationInSeconds) ?? 0,
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
