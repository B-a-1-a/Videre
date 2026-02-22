import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useEditorStore } from "../../store/editorStore";
import { TimelineRuler } from "./TimelineRuler";
import { TimelineTrack } from "./TimelineTrack";
import { Playhead } from "./Playhead";
import { TRACK_HEADER_WIDTH_PX, RULER_HEIGHT_PX, MIN_ZOOM_PX_PER_SEC, MAX_ZOOM_PX_PER_SEC } from "./constants";
import { clamp, msToClockTimecode, msToPx, parseTimecodeToMs, pxToMs, snapMs } from "./utils";
import type { Clip } from "../../types/domain";

export function Timeline() {
  const timeline = useEditorStore((s) => s.timeline);
  const assets = useEditorStore((s) => s.assets);
  const zoomPxPerSec = useEditorStore((s) => s.zoomPxPerSec);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const selectedTrackId = useEditorStore((s) => s.selectedTrackId);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedClipIds = useEditorStore((s) => s.selectedClipIds);
  const setPlayheadMs = useEditorStore((s) => s.setPlayheadMs);
  const setSelectedTrack = useEditorStore((s) => s.setSelectedTrack);
  const toggleClipSelection = useEditorStore((s) => s.toggleClipSelection);
  const applyTimelinePatch = useEditorStore((s) => s.applyTimelinePatch);
  const addClipFromAsset = useEditorStore((s) => s.addClipFromAsset);
  const addTrack = useEditorStore((s) => s.addTrack);
  const removeTrack = useEditorStore((s) => s.removeTrack);
  const deleteSelectedClip = useEditorStore((s) => s.deleteSelectedClip);
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead);
  const setZoomPxPerSec = useEditorStore((s) => s.setZoomPxPerSec);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [visibleWidth, setVisibleWidth] = useState(800);
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [timeInputValue, setTimeInputValue] = useState("");

  // Track container scroll
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setVisibleWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      setScrollLeft(scrollContainerRef.current.scrollLeft);
    }
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();

      const step = event.deltaY > 0 ? -20 : 20;
      const currentZoom = useEditorStore.getState().zoomPxPerSec;
      setZoomPxPerSec(clamp(currentZoom + step, MIN_ZOOM_PX_PER_SEC, MAX_ZOOM_PX_PER_SEC));
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
    };
  }, [setZoomPxPerSec]);

  // Build clips-by-track map
  const clipsByTrack = useMemo(() => {
    const map = new Map<string, Clip[]>();
    if (!timeline) return map;
    for (const track of timeline.tracks) {
      map.set(track.id, []);
    }
    for (const clip of timeline.clips) {
      const arr = map.get(clip.trackId);
      if (arr) arr.push(clip);
    }
    return map;
  }, [timeline]);

  const durationMs = timeline?.durationMs ?? 0;
  const totalWidth = msToPx(durationMs, zoomPxPerSec) + visibleWidth;

  // Playhead scrub
  const handlePlayheadScrubStart = useCallback(
    (_e: React.MouseEvent) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        const x = moveEvent.clientX - rect.left + container.scrollLeft - TRACK_HEADER_WIDTH_PX;
        const ms = snapMs(pxToMs(Math.max(0, x), zoomPxPerSec));
        setPlayheadMs(Math.max(0, ms));
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [zoomPxPerSec, setPlayheadMs],
  );

  // Clip drag
  const handleClipDragStart = useCallback(
    (e: React.MouseEvent, clip: Clip, dragType: "move" | "trim-left" | "trim-right") => {
      e.preventDefault();
      const startX = e.clientX;
      const startMs = clip.timelineStartMs;
      const startIn = clip.sourceInMs;
      const startOut = clip.sourceOutMs;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaMs = pxToMs(deltaX, zoomPxPerSec);

        if (dragType === "move") {
          const newStart = snapMs(Math.max(0, startMs + deltaMs));
          // Visual feedback only - we commit on mouseup
          // For now, we directly apply. Could optimize with a preview state.
          void applyTimelinePatch([
            { type: "move_clip", clipId: clip.id, timelineStartMs: newStart },
          ]);
        } else if (dragType === "trim-left") {
          const newIn = snapMs(Math.max(0, startIn + deltaMs));
          if (newIn < startOut) {
            void applyTimelinePatch([
              { type: "trim_clip", clipId: clip.id, sourceInMs: newIn, sourceOutMs: startOut },
            ]);
          }
        } else if (dragType === "trim-right") {
          const newOut = snapMs(Math.max(startIn + 10, startOut + deltaMs));
          void applyTimelinePatch([
            { type: "trim_clip", clipId: clip.id, sourceInMs: startIn, sourceOutMs: newOut },
          ]);
        }
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [zoomPxPerSec, applyTimelinePatch],
  );

  // Click on lane sets playhead
  const handleLaneClick = useCallback(
    (_trackId: string, ms: number) => {
      setPlayheadMs(ms);
    },
    [setPlayheadMs],
  );

  // Ruler click/drag sets playhead
  const handleRulerScrub = useCallback(
    (ms: number) => {
      setPlayheadMs(ms);
    },
    [setPlayheadMs],
  );

  const handleDropAssetToTrack = useCallback(
    (trackId: string, ms: number, assetId: string) => {
      void addClipFromAsset(assetId, trackId, ms);
    },
    [addClipFromAsset],
  );

  const handleClipContextMenu = useCallback(
    (_e: React.MouseEvent, clip: Clip) => {
      toggleClipSelection(clip.id, false);
    },
    [toggleClipSelection],
  );

  const handleCommitTimeInput = useCallback(() => {
    const parsedMs = parseTimecodeToMs(timeInputValue, timeline?.fps ?? 30);
    setIsEditingTime(false);
    setTimeInputValue("");
    if (parsedMs === null) return;
    setPlayheadMs(Math.max(0, Math.min(parsedMs, durationMs)));
  }, [durationMs, setPlayheadMs, timeInputValue, timeline?.fps]);

  const handleDeleteTrack = useCallback(
    (trackId: string) => {
      void removeTrack(trackId);
    },
    [removeTrack],
  );

  const tracks = timeline?.tracks ?? [];
  const trackAreaHeight = tracks.length * 48 + RULER_HEIGHT_PX;

  return (
    <div className="timeline-container">
      <div className="timeline-toolbar">
        <div className="timeline-toolbar-group">
          <button onClick={() => void addTrack("video")} type="button">+ Video Track</button>
          <button onClick={() => void addTrack("audio")} type="button">+ Audio Track</button>
        </div>
        <div className="timeline-toolbar-group">
          <button onClick={() => void splitAtPlayhead()} title="Split selected clip (S)" type="button">Split</button>
          <button disabled={!selectedClipId} onClick={() => void deleteSelectedClip()} title="Delete selected clip" type="button">
            Delete
          </button>
        </div>
        <div className="timeline-toolbar-group timeline-toolbar-zoom">
          <button
            onClick={() => setZoomPxPerSec(clamp(zoomPxPerSec - 20, MIN_ZOOM_PX_PER_SEC, MAX_ZOOM_PX_PER_SEC))}
            title="Zoom out"
            type="button"
          >
            −
          </button>
          <button
            className="timeline-zoom-pill"
            onClick={() => setZoomPxPerSec(100)}
            title="Reset zoom"
            type="button"
          >
            {Math.round((zoomPxPerSec / 100) * 100)}%
          </button>
          <button
            onClick={() => setZoomPxPerSec(clamp(zoomPxPerSec + 20, MIN_ZOOM_PX_PER_SEC, MAX_ZOOM_PX_PER_SEC))}
            title="Zoom in"
            type="button"
          >
            +
          </button>
        </div>
      </div>
      <div
        className="timeline-scroll-area"
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        <div className="timeline-content" style={{ position: "relative" }}>
          {/* Ruler */}
          <div className="timeline-ruler-row">
            <div className="timeline-ruler-readout">
              {isEditingTime ? (
                <input
                  value={timeInputValue}
                  onBlur={handleCommitTimeInput}
                  onChange={(event) => setTimeInputValue(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleCommitTimeInput();
                    } else if (event.key === "Escape") {
                      setIsEditingTime(false);
                      setTimeInputValue("");
                    }
                  }}
                  autoFocus
                />
              ) : (
                <button
                  onClick={() => {
                    setIsEditingTime(true);
                    setTimeInputValue(msToClockTimecode(playheadMs));
                  }}
                  title="Jump to time (HH:MM:SS.mmm or 120f)"
                  type="button"
                >
                  {msToClockTimecode(playheadMs)}
                </button>
              )}
            </div>
            <TimelineRuler
              durationMs={durationMs}
              zoomPxPerSec={zoomPxPerSec}
              scrollLeft={scrollLeft}
              visibleWidth={visibleWidth}
              playheadMs={playheadMs}
              onScrubMs={handleRulerScrub}
            />
          </div>

          {/* Tracks */}
          {tracks.map((track) => {
            const trackTransitions = (timeline?.transitions ?? []).filter(
              (t) => t.trackId === track.id,
            );
            return (
              <TimelineTrack
                key={track.id}
                track={track}
                clips={clipsByTrack.get(track.id) ?? []}
                assets={assets}
                textOverlays={timeline?.textOverlays ?? []}
                transitions={trackTransitions}
                zoomPxPerSec={zoomPxPerSec}
                totalWidth={totalWidth}
                isSelected={track.id === selectedTrackId}
                selectedClipIds={selectedClipIds}
                onSelectTrack={setSelectedTrack}
                onSelectClip={toggleClipSelection}
                onClipContextMenu={handleClipContextMenu}
                onDeleteTrack={handleDeleteTrack}
                onClipDragStart={handleClipDragStart}
                onLaneClick={handleLaneClick}
                onDropAsset={handleDropAssetToTrack}
              />
            );
          })}

          {/* Playhead overlay */}
          <div className="timeline-playhead-overlay" style={{ left: TRACK_HEADER_WIDTH_PX }}>
            <Playhead
              playheadMs={playheadMs}
              zoomPxPerSec={zoomPxPerSec}
              height={trackAreaHeight}
              onScrubStart={handlePlayheadScrubStart}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
