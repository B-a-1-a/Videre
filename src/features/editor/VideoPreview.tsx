import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEditorStore } from "../../store/editorStore";
import type { AssetKind, TextOverlay, TrackKind } from "../../types/domain";
import { msToClockTimecode, parseTimecodeToMs } from "./utils";

interface PreviewLayer {
  id: string;
  trackKind: TrackKind;
  trackOrder: number;
  assetKind: AssetKind;
  fileName: string;
  sourceUrl: string;
  sourceOffsetMs: number;
  width?: number;
  height?: number;
}

export function VideoPreview() {
  const timeline = useEditorStore((s) => s.timeline);
  const assets = useEditorStore((s) => s.assets);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const setPlayheadMs = useEditorStore((s) => s.setPlayheadMs);
  const togglePlayback = useEditorStore((s) => s.togglePlayback);

  const previewContainerRef = useRef<HTMLDivElement>(null);
  const mediaElementRefs = useRef(new Map<string, HTMLMediaElement>());
  const [previewMuted, setPreviewMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [timeInputValue, setTimeInputValue] = useState("");

  const visibleLayers = useMemo((): PreviewLayer[] => {
    if (!timeline) return [];
    const trackById = new Map(timeline.tracks.map((track) => [track.id, track]));
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const layers: PreviewLayer[] = [];

    for (const clip of timeline.clips) {
      const track = trackById.get(clip.trackId);
      const asset = assetById.get(clip.assetId);
      if (!track || !asset) continue;

      const clipDurationMs = clip.sourceOutMs - clip.sourceInMs;
      if (clipDurationMs <= 0) continue;
      const clipEndMs = clip.timelineStartMs + clipDurationMs;
      if (playheadMs < clip.timelineStartMs || playheadMs >= clipEndMs) continue;

      const sourcePath = asset.proxyPath ?? asset.managedPath;
      if (!sourcePath) continue;

      layers.push({
        id: clip.id,
        trackKind: track.kind,
        trackOrder: track.orderIndex,
        assetKind: asset.kind,
        fileName: asset.fileName,
        sourceUrl: convertFileSrc(sourcePath),
        sourceOffsetMs: clip.sourceInMs + (playheadMs - clip.timelineStartMs),
        width: asset.width,
        height: asset.height,
      });
    }

    // Render back-to-front while keeping lower track order on top.
    layers.sort((a, b) => {
      if (a.trackOrder !== b.trackOrder) return b.trackOrder - a.trackOrder;
      return a.id.localeCompare(b.id);
    });
    return layers;
  }, [timeline, assets, playheadMs]);

  const visualLayers = useMemo(
    () => visibleLayers.filter((layer) => layer.trackKind === "video" && (layer.assetKind === "video" || layer.assetKind === "image")),
    [visibleLayers],
  );
  const audioLayers = useMemo(
    () => visibleLayers.filter((layer) => layer.assetKind === "audio"),
    [visibleLayers],
  );
  const avLayers = useMemo(
    () => [...visualLayers.filter((layer) => layer.assetKind === "video"), ...audioLayers],
    [visualLayers, audioLayers],
  );
  const topVisualLayer = visualLayers[visualLayers.length - 1];

  // Text overlays visible at the current playhead
  const visibleTextOverlays = useMemo((): TextOverlay[] => {
    if (!timeline) return [];
    const result: TextOverlay[] = [];
    for (const clip of timeline.clips) {
      if (clip.assetId !== "__text__") continue;
      const clipDurationMs = clip.sourceOutMs - clip.sourceInMs;
      if (clipDurationMs <= 0) continue;
      const clipEndMs = clip.timelineStartMs + clipDurationMs;
      if (playheadMs < clip.timelineStartMs || playheadMs >= clipEndMs) continue;
      const overlay = timeline.textOverlays.find((o) => o.clipId === clip.id);
      if (overlay) result.push(overlay);
    }
    return result;
  }, [timeline, playheadMs]);

  const previewResolution = useMemo(() => {
    for (let index = visualLayers.length - 1; index >= 0; index -= 1) {
      const layer = visualLayers[index];
      if (layer.width && layer.height && layer.width > 0 && layer.height > 0) {
        return { width: layer.width, height: layer.height };
      }
    }
    const fallback = assets.find(
      (asset) =>
        (asset.kind === "video" || asset.kind === "image")
        && asset.width
        && asset.height
        && asset.width > 0
        && asset.height > 0,
    );
    return {
      width: fallback?.width ?? 1920,
      height: fallback?.height ?? 1080,
    };
  }, [visualLayers, assets]);

  const bindMediaRef = useCallback(
    (id: string) => (element: HTMLMediaElement | null) => {
      if (!element) {
        mediaElementRefs.current.delete(id);
        return;
      }
      mediaElementRefs.current.set(id, element);
    },
    [],
  );

  useEffect(() => {
    const activeMediaIds = new Set(avLayers.map((layer) => layer.id));

    for (const [id, element] of mediaElementRefs.current.entries()) {
      if (!activeMediaIds.has(id)) {
        element.pause();
      }
    }

    for (const layer of avLayers) {
      const element = mediaElementRefs.current.get(layer.id);
      if (!element) continue;

      element.muted = previewMuted;
      const targetTime = layer.sourceOffsetMs / 1000;

      if (!isPlaying) {
        element.pause();
        if (Math.abs(element.currentTime - targetTime) > 0.05) {
          element.currentTime = targetTime;
        }
        continue;
      }

      if (Math.abs(element.currentTime - targetTime) > 0.3) {
        element.currentTime = targetTime;
      }
      if (element.paused) {
        void element.play().catch(() => {});
      }
    }
  }, [avLayers, isPlaying, previewMuted]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === previewContainerRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!previewContainerRef.current) return;
    if (document.fullscreenElement === previewContainerRef.current) {
      void document.exitFullscreen();
      return;
    }
    void previewContainerRef.current.requestFullscreen();
  }, []);

  const commitTimeInput = useCallback(() => {
    const parsedMs = parseTimecodeToMs(timeInputValue, timeline?.fps ?? 30);
    if (parsedMs === null) {
      setIsEditingTime(false);
      setTimeInputValue("");
      return;
    }
    const clamped = Math.max(0, Math.min(parsedMs, timeline?.durationMs ?? parsedMs));
    setPlayheadMs(clamped);
    setIsEditingTime(false);
    setTimeInputValue("");
  }, [setPlayheadMs, timeline, timeInputValue]);

  return (
    <div className="video-preview">
      <div className="video-preview-stage" ref={previewContainerRef}>
        <div
          className="video-preview-canvas"
          style={{ aspectRatio: `${previewResolution.width} / ${previewResolution.height}` }}
        >
          {visualLayers.map((layer, index) => (
            <div className="preview-layer" key={layer.id} style={{ zIndex: index + 1 }}>
              {layer.assetKind === "video" ? (
                <video
                  className="preview-layer-media"
                  ref={bindMediaRef(layer.id)}
                  src={layer.sourceUrl}
                  playsInline
                  preload="metadata"
                />
              ) : (
                <img className="preview-layer-media" src={layer.sourceUrl} alt={layer.fileName} draggable={false} />
              )}
            </div>
          ))}

          {/* Text overlays */}
          {visibleTextOverlays.map((overlay) => (
            <div
              key={overlay.id}
              className="preview-text-overlay"
              style={{
                position: "absolute",
                left: `${overlay.positionX * 100}%`,
                top: `${overlay.positionY * 100}%`,
                transform: "translate(-50%, -50%)",
                fontFamily: overlay.fontFamily,
                fontSize: `${overlay.fontSize}px`,
                fontWeight: overlay.fontWeight === "bold" ? 700 : 400,
                color: overlay.fontColor,
                textAlign: overlay.textAlign as React.CSSProperties["textAlign"],
                backgroundColor: overlay.backgroundColor ?? "transparent",
                padding: "0.2em 0.4em",
                zIndex: visualLayers.length + 10,
                pointerEvents: "none",
                whiteSpace: "pre-wrap",
                textShadow: "0 2px 4px rgba(0,0,0,0.7)",
              }}
            >
              {overlay.content}
            </div>
          ))}

          {audioLayers.map((layer) => (
            <audio key={layer.id} ref={bindMediaRef(layer.id)} src={layer.sourceUrl} preload="metadata" />
          ))}

          {visualLayers.length === 0 && visibleTextOverlays.length === 0 && (
            <div className="video-preview-empty">No visual clip at playhead</div>
          )}
        </div>

        {topVisualLayer && (
          <div className="video-preview-overlay">
            <span>{topVisualLayer.fileName}</span>
          </div>
        )}
      </div>

      <div className="video-preview-controls">
        <div className="preview-controls-left">
          <button
            className="play-pause-btn"
            onClick={togglePlayback}
            type="button"
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            className="preview-control-btn"
            onClick={() => setPreviewMuted((value) => !value)}
            type="button"
            title={previewMuted ? "Unmute preview" : "Mute preview"}
          >
            {previewMuted ? "Muted" : "Sound"}
          </button>
          <button
            className="preview-control-btn"
            onClick={toggleFullscreen}
            type="button"
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? "Exit Full" : "Fullscreen"}
          </button>
        </div>

        <div className="preview-controls-center">
          {isEditingTime ? (
            <input
              className="preview-time-input"
              value={timeInputValue}
              onChange={(event) => setTimeInputValue(event.currentTarget.value)}
              onBlur={commitTimeInput}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitTimeInput();
                } else if (event.key === "Escape") {
                  setIsEditingTime(false);
                  setTimeInputValue("");
                }
              }}
              autoFocus
            />
          ) : (
            <button
              className="preview-timecode-btn"
              onClick={() => {
                setIsEditingTime(true);
                setTimeInputValue(msToClockTimecode(playheadMs));
              }}
              type="button"
              title="Click to jump to time (supports HH:MM:SS.mmm or 120f)"
            >
              {msToClockTimecode(playheadMs)}
            </button>
          )}
        </div>

        <div className="preview-controls-meta">
          <span>{previewResolution.width}×{previewResolution.height}</span>
          <span>{visualLayers.length} visual</span>
          <span>{audioLayers.length} audio</span>
        </div>
      </div>
    </div>
  );
}
