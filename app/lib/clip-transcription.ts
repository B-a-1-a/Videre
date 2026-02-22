import {
  FPS,
  type ScrubberState,
} from "~/components/timeline/types";
import type {
  ClipTranscriptRecord,
  ClipTranscriptWord,
} from "~/components/media/captions.types";
import { extractStorageKey } from "~/lib/media-persistence";
import { apiUrl } from "~/utils/api";

export const TRANSCRIPT_UNAVAILABLE_MESSAGE =
  "Transcript not available for this clip.";

export type TranscribeClipJob = {
  scrubberId: string;
  name: string;
  mediaType: "video" | "audio";
  storageKey: string;
  durationInSeconds: number;
  trimBeforeFrames: number;
  trimAfterFrames: number;
};

export type TranscribeClipResponseItem = {
  scrubberId: string;
  text: string;
  words: ClipTranscriptWord[];
  clipStartSec: number;
  clipEndSec: number;
  error: string | null;
};

export type TranscribeClipsResponse = {
  model: string;
  timestamps: string;
  results: TranscribeClipResponseItem[];
};

type BuildTranscribeJobError = {
  error: string;
};

type RequestClipTranscriptionParams = {
  projectId?: string;
  jobs: TranscribeClipJob[];
  model?: string;
  timestamps?: "word";
  signal?: AbortSignal;
};

type NormalizeClipTranscriptRecordParams = {
  scrubberId: string;
  scrubber: ScrubberState | null;
  result?: TranscribeClipResponseItem | null;
  error?: string | null;
  updatedAt?: string;
};

function sanitizeUnavailableReason(reason?: string | null): string {
  const trimmed = String(reason || "").trim();
  if (!trimmed) return TRANSCRIPT_UNAVAILABLE_MESSAGE;
  const firstLine = trimmed.split(/\r?\n/).find((line) => line.trim().length > 0) || "";
  const condensed = firstLine.replace(/\s+/g, " ").trim();
  const detail =
    condensed.length > 180 ? `${condensed.slice(0, 177)}...` : condensed;
  if (!detail) return TRANSCRIPT_UNAVAILABLE_MESSAGE;
  if (detail.toLowerCase().startsWith(TRANSCRIPT_UNAVAILABLE_MESSAGE.toLowerCase())) {
    return detail;
  }
  return `${TRANSCRIPT_UNAVAILABLE_MESSAGE} ${detail}`;
}

function coerceWords(words: unknown): ClipTranscriptWord[] {
  if (!Array.isArray(words)) return [];
  return words
    .filter((word) => {
      const value = word as Partial<ClipTranscriptWord>;
      return (
        typeof value.text === "string" &&
        value.text.trim().length > 0 &&
        Number.isFinite(value.start) &&
        Number.isFinite(value.end) &&
        Number(value.end) >= Number(value.start)
      );
    })
    .map((word) => {
      const value = word as ClipTranscriptWord;
      return {
        text: value.text.trim(),
        start: Number(value.start),
        end: Number(value.end),
      };
    });
}

function computeScrubberBounds(scrubber: ScrubberState | null): {
  clipStartSec: number;
  clipEndSec: number;
} {
  if (!scrubber || !Number.isFinite(scrubber.durationInSeconds)) {
    return { clipStartSec: 0, clipEndSec: 0 };
  }
  const clipStartSec = Math.max(0, (scrubber.trimBefore || 0) / FPS);
  const clipEndSec = Math.max(
    clipStartSec + 1 / FPS,
    Number(scrubber.durationInSeconds) - (scrubber.trimAfter || 0) / FPS
  );
  return { clipStartSec, clipEndSec };
}

export function buildTranscribeJobFromScrubber(
  scrubber: ScrubberState
): TranscribeClipJob | BuildTranscribeJobError {
  if (scrubber.mediaType !== "video" && scrubber.mediaType !== "audio") {
    return { error: TRANSCRIPT_UNAVAILABLE_MESSAGE };
  }

  const storageKey =
    scrubber.storageKey || extractStorageKey(scrubber.mediaUrlRemote);
  if (!storageKey) {
    return { error: "Clip has no server media asset." };
  }

  if (
    !Number.isFinite(scrubber.durationInSeconds) ||
    scrubber.durationInSeconds <= 0
  ) {
    return { error: "Clip has no valid duration." };
  }

  return {
    scrubberId: scrubber.id,
    name: scrubber.name,
    mediaType: scrubber.mediaType,
    storageKey,
    durationInSeconds: Number(scrubber.durationInSeconds),
    trimBeforeFrames: scrubber.trimBefore || 0,
    trimAfterFrames: scrubber.trimAfter || 0,
  };
}

export async function requestClipTranscription({
  projectId,
  jobs,
  model = "openai/whisper-small",
  timestamps = "word",
  signal,
}: RequestClipTranscriptionParams): Promise<TranscribeClipsResponse> {
  if (!jobs.length) {
    return {
      model,
      timestamps,
      results: [],
    };
  }

  const response = await fetch(apiUrl("/transcribe-clips"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      model,
      timestamps,
      clips: jobs,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Transcription request failed.");
  }

  const payload = (await response.json()) as TranscribeClipsResponse;
  return payload;
}

export function normalizeClipTranscriptRecord({
  scrubberId,
  scrubber,
  result,
  error,
  updatedAt = new Date().toISOString(),
}: NormalizeClipTranscriptRecordParams): ClipTranscriptRecord {
  const bounds = computeScrubberBounds(scrubber);
  const resultClipStart = Number(result?.clipStartSec);
  const resultClipEnd = Number(result?.clipEndSec);
  const clipStartSec = Number.isFinite(resultClipStart)
    ? resultClipStart
    : bounds.clipStartSec;
  const clipEndCandidate = Number.isFinite(resultClipEnd)
    ? resultClipEnd
    : bounds.clipEndSec;
  const clipEndSec = Math.max(clipStartSec + 1 / FPS, clipEndCandidate);

  const normalizedError = error ?? result?.error ?? null;

  return {
    scrubberId,
    scrubberName: scrubber?.name || result?.scrubberId || scrubberId,
    mediaType: scrubber?.mediaType === "audio" ? "audio" : "video",
    text: typeof result?.text === "string" ? result.text.trim() : "",
    words: coerceWords(result?.words),
    clipStartSec: Number.isFinite(clipStartSec) ? clipStartSec : 0,
    clipEndSec: Number.isFinite(clipEndSec) ? clipEndSec : 0,
    error:
      normalizedError && String(normalizedError).trim().length > 0
        ? sanitizeUnavailableReason(normalizedError)
        : null,
    updatedAt,
  };
}
