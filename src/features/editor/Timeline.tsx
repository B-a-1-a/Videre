import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useEditorStore } from "../../store/editorStore";
import { TimelineRuler } from "./TimelineRuler";
import { TimelineTrack } from "./TimelineTrack";
import { Playhead } from "./Playhead";
import { TRACK_HEADER_WIDTH_PX, RULER_HEIGHT_PX } from "./constants";
import { msToPx, pxToMs, snapMs } from "./utils";
import type { Clip } from "../../types/domain";

export function Timeline() {
  const timeline = useEditorStore((s) => s.timeline);
  const assets = useEditorStore((s) => s.assets);
  const zoomPxPerSec = useEditorStore((s) => s.zoomPxPerSec);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const selectedTrackId = useEditorStore((s) => s.selectedTrackId);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const setPlayheadMs = useEditorStore((s) => s.setPlayheadMs);
  const setSelectedTrack = useEditorStore((s) => s.setSelectedTrack);
  const setSelectedClip = useEditorStore((s) => s.setSelectedClip);
  const applyTimelinePatch = useEditorStore((s) => s.applyTimelinePatch);
  const addTrack = useEditorStore((s) => s.addTrack);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [visibleWidth, setVisibleWidth] = useState(800);

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

  // Ruler click sets playhead
  const handleRulerClick = useCallback(
    (ms: number) => {
      setPlayheadMs(ms);
    },
    [setPlayheadMs],
  );

  const tracks = timeline?.tracks ?? [];
  const trackAreaHeight = tracks.length * 48 + RULER_HEIGHT_PX;

  return (
    <div className="timeline-container">
      <div className="timeline-toolbar">
        <button onClick={() => void addTrack("video")} type="button">+ Video Track</button>
        <button onClick={() => void addTrack("audio")} type="button">+ Audio Track</button>
      </div>
      <div
        className="timeline-scroll-area"
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        <div className="timeline-content" style={{ position: "relative" }}>
          {/* Ruler */}
          <div className="timeline-ruler-row" style={{ paddingLeft: TRACK_HEADER_WIDTH_PX }}>
            <TimelineRuler
              durationMs={durationMs}
              zoomPxPerSec={zoomPxPerSec}
              scrollLeft={scrollLeft}
              visibleWidth={visibleWidth}
              onClickMs={handleRulerClick}
            />
          </div>

          {/* Tracks */}
          {tracks.map((track) => (
            <TimelineTrack
              key={track.id}
              track={track}
              clips={clipsByTrack.get(track.id) ?? []}
              assets={assets}
              zoomPxPerSec={zoomPxPerSec}
              totalWidth={totalWidth}
              isSelected={track.id === selectedTrackId}
              selectedClipId={selectedClipId}
              onSelectTrack={setSelectedTrack}
              onSelectClip={setSelectedClip}
              onClipDragStart={handleClipDragStart}
              onLaneClick={handleLaneClick}
            />
          ))}

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
