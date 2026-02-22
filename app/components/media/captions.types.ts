export type ClipTranscriptWord = {
  text: string;
  start: number;
  end: number;
};

export type ClipTranscriptRecord = {
  scrubberId: string;
  scrubberName: string;
  mediaType: "video" | "audio";
  text: string;
  words: ClipTranscriptWord[];
  clipStartSec: number;
  clipEndSec: number;
  error: string | null;
  updatedAt: string;
};

export type ClipTranscriptsMap = Record<string, ClipTranscriptRecord>;
