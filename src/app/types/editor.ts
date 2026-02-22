export interface Transition {
  id: string;
  presentation: "fade" | "wipe" | "clockWipe" | "slide" | "flip" | "iris";
  timing: "spring" | "linear";
  durationInFrames: number;
  leftScrubberId: string | null;
  rightScrubberId: string | null;
}

export interface TextProperties {
  textContent: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  textAlign: "left" | "center" | "right";
  fontWeight: "normal" | "bold";
  template: "normal" | "glassy" | null;
}

export interface BaseScrubber {
  id: string;
  mediaType: "video" | "image" | "audio" | "text" | "groupped_scrubber";
  mediaUrlLocal: string | null;
  mediaUrlRemote: string | null;
  media_width: number;
  media_height: number;
  text: TextProperties | null;
  groupped_scrubbers: ScrubberState[] | null;
  left_transition_id: string | null;
  right_transition_id: string | null;
}

export interface MediaBinItem extends BaseScrubber {
  name: string;
  durationInSeconds: number;
  uploadProgress: number | null;
  isUploading: boolean;
}

export interface ScrubberState extends MediaBinItem {
  left: number;
  y: number;
  width: number;
  sourceMediaBinId: string;
  left_player: number;
  top_player: number;
  width_player: number;
  height_player: number;
  is_dragging: boolean;
  trimBefore: number | null;
  trimAfter: number | null;
}

export interface TrackState {
  id: string;
  scrubbers: ScrubberState[];
  transitions: Transition[];
}

export interface TimelineState {
  tracks: TrackState[];
}

export interface KlypProjectState {
  timeline: TimelineState;
  textBinItems: MediaBinItem[];
}

export type RenderJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  progress: number;
  outputPath?: string;
  error?: string;
};

export type AnalysisJob = {
  id: string;
  jobKind: string;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  message: string;
};

export type ProjectCard = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectState = {
  summary: ProjectCard;
  timeline: TimelineState;
  textBinItems: MediaBinItem[];
  assets: Array<{
    id: string;
    fileName: string;
    kind: "video" | "audio" | "image";
    managedPath: string;
    durationMs?: number;
    width?: number;
    height?: number;
  }>;
};
