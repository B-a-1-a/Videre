import { useEffect, useMemo, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import { msToTimecode } from "./utils";

interface ClipAtPlayhead {
  assetPath: string;
  offsetMs: number;
  kind: string;
}

export function VideoPreview() {
  const timeline = useEditorStore((s) => s.timeline);
  const assets = useEditorStore((s) => s.assets);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const togglePlayback = useEditorStore((s) => s.togglePlayback);

  const videoRef = useRef<HTMLVideoElement>(null);
  const prevSrcRef = useRef<string>("");

  // Find the topmost video clip at the current playhead position
  const clipAtPlayhead = useMemo((): ClipAtPlayhead | null => {
    if (!timeline) return null;

    // Sort tracks by orderIndex (topmost first = lowest index)
    const videoTracks = timeline.tracks
      .filter((t) => t.kind === "video")
      .sort((a, b) => a.orderIndex - b.orderIndex);

    for (const track of videoTracks) {
      for (const clip of timeline.clips) {
        if (clip.trackId !== track.id) continue;
        const clipEnd = clip.timelineStartMs + (clip.sourceOutMs - clip.sourceInMs);
        if (playheadMs >= clip.timelineStartMs && playheadMs < clipEnd) {
          const asset = assets.find((a) => a.id === clip.assetId);
          if (!asset) continue;
          const path = asset.proxyPath ?? asset.managedPath;
          const offsetMs = clip.sourceInMs + (playheadMs - clip.timelineStartMs);
          return { assetPath: path, offsetMs, kind: asset.kind };
        }
      }
    }
    return null;
  }, [timeline, assets, playheadMs]);

  // Update video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!clipAtPlayhead || clipAtPlayhead.kind === "audio") {
      if (prevSrcRef.current !== "") {
        video.src = "";
        video.load();
        prevSrcRef.current = "";
      }
      return;
    }

    const src = convertFileSrc(clipAtPlayhead.assetPath);
    if (src !== prevSrcRef.current) {
      video.src = src;
      prevSrcRef.current = src;
      video.load();
    }

    // Set current time
    const targetTime = clipAtPlayhead.offsetMs / 1000;
    if (!isPlaying) {
      video.pause();
      // Only seek if significantly different
      if (Math.abs(video.currentTime - targetTime) > 0.05) {
        video.currentTime = targetTime;
      }
    } else {
      if (Math.abs(video.currentTime - targetTime) > 0.3) {
        video.currentTime = targetTime;
      }
      if (video.paused) {
        void video.play().catch(() => {});
      }
    }
  }, [clipAtPlayhead, isPlaying]);

  // Pause video when playback stops
  useEffect(() => {
    if (!isPlaying && videoRef.current) {
      videoRef.current.pause();
    }
  }, [isPlaying]);

  return (
    <div className="video-preview">
      <div className="video-preview-canvas">
        <video ref={videoRef} muted playsInline />
        {!clipAtPlayhead && (
          <div className="video-preview-empty">No clip at playhead</div>
        )}
      </div>
      <div className="video-preview-controls">
        <button
          className="play-pause-btn"
          onClick={togglePlayback}
          type="button"
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
        <span className="timecode">{msToTimecode(playheadMs)}</span>
      </div>
    </div>
  );
}
