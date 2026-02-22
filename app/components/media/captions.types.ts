export type ClipTranscriptWord = {
  text: string;
  start: number;
  end: number;
};

export type ClipTranscriptSegment = {
  text: string;
  words: ClipTranscriptWord[];
  startSec: number;
  endSec: number;
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

export type ApplyTranscriptEditRequest = {
  scrubberId: string;
  editedText: string;
  segments: ClipTranscriptSegment[];
};

export type ApplyTranscriptEditResult = {
  success: boolean;
  scrubberId: string;
  newScrubberIds: string[];
  error: string | null;
};

export type CaptionTextStyle = {
  fontSize: number;
  fontFamily: string;
  color: string;
  textAlign: "left" | "center" | "right";
  fontWeight: "normal" | "bold";
};

export type GenerateClipCaptionsRequest = {
  referenceScrubberId: string;
  segments: Array<{
    text: string;
    startSec: number;
    endSec: number;
  }>;
  textStyle: CaptionTextStyle;
  replaceExisting?: boolean;
};

export type GenerateClipCaptionsResult = {
  success: boolean;
  referenceScrubberId: string;
  captionTrackId: string | null;
  createdScrubberIds: string[];
  error: string | null;
};
