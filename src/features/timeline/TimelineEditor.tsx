import { useEffect, useMemo, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { useEditorStore, getSelectedClip } from "../../store/editorStore";
import type { Clip, TimelineOperation, Track } from "../../types/domain";

const SNAP_MS = 10;

function clipDurationMs(clip: Clip): number {
  return Math.max(clip.sourceOutMs - clip.sourceInMs, 1);
}

function msToLabel(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

export function TimelineEditor() {
  const timeline = useEditorStore((state) => state.timeline);
  const zoomPxPerSec = useEditorStore((state) => state.zoomPxPerSec);
  const playheadMs = useEditorStore((state) => state.playheadMs);
  const selectedTrackId = useEditorStore((state) => state.selectedTrackId);
  const selectedClipId = useEditorStore((state) => state.selectedClipId);

  const setPlayheadMs = useEditorStore((state) => state.setPlayheadMs);
  const setZoomPxPerSec = useEditorStore((state) => state.setZoomPxPerSec);
  const setSelectedClip = useEditorStore((state) => state.setSelectedClip);
  const setSelectedTrack = useEditorStore((state) => state.setSelectedTrack);
  const applyTimelinePatch = useEditorStore((state) => state.applyTimelinePatch);

  const [trimInMs, setTrimInMs] = useState(0);
  const [trimOutMs, setTrimOutMs] = useState(1000);
  const selectedClip = useMemo(
    () => getSelectedClip({ timeline, selectedClipId }),
    [timeline, selectedClipId],
  );

  useEffect(() => {
    if (selectedClip) {
      setTrimInMs(selectedClip.sourceInMs);
      setTrimOutMs(selectedClip.sourceOutMs);
    }
  }, [selectedClip]);

  if (!timeline) {
    return (
      <section className="panel timeline-panel">
        <header className="panel-header">
          <h2>Timeline</h2>
        </header>
        <div className="muted">Open a project to start editing.</div>
      </section>
    );
  }

  const maxDurationMs = Math.max(timeline.durationMs, 30_000);
  const timelineWidth = (maxDurationMs / 1000) * zoomPxPerSec;
  const rulerTicks = Math.ceil(maxDurationMs / 1000);

  const clipsByTrack = new Map<string, Clip[]>();
  for (const track of timeline.tracks) {
    clipsByTrack.set(track.id, []);
  }
  for (const clip of timeline.clips) {
    const clips = clipsByTrack.get(clip.trackId);
    if (clips) clips.push(clip);
  }
  for (const clips of clipsByTrack.values()) {
    clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  }

  async function patch(operations: TimelineOperation[]) {
    await applyTimelinePatch(operations);
  }

  async function addTrack(kind: "video" | "audio") {
    const count = timeline?.tracks.length ?? 0;
    await patch([{ type: "add_track", kind, name: `${kind === "video" ? "Video" : "Audio"} ${count + 1}` }]);
  }

  async function reorderTrack(track: Track, direction: "up" | "down") {
    const delta = direction === "up" ? -1 : 1;
    await patch([
      {
        type: "reorder_track",
        trackId: track.id,
        newIndex: track.orderIndex + delta,
      },
    ]);
  }

  async function splitClip() {
    if (!selectedClip) return;
    await patch([{ type: "split_clip", clipId: selectedClip.id, atTimelineMs: playheadMs }]);
  }

  async function trimSelectedClip() {
    if (!selectedClip) return;
    await patch([
      {
        type: "trim_clip",
        clipId: selectedClip.id,
        sourceInMs: trimInMs,
        sourceOutMs: trimOutMs,
      },
    ]);
  }

  async function deleteSelectedClip() {
    if (!selectedClip) return;
    await patch([{ type: "delete_clip", clipId: selectedClip.id }]);
    setSelectedClip(undefined);
  }

  function snap(ms: number): number {
    return Math.max(0, Math.round(ms / SNAP_MS) * SNAP_MS);
  }

  function handleLaneClick(event: MouseEvent<HTMLDivElement>) {
    const lane = event.currentTarget;
    const rect = lane.getBoundingClientRect();
    const x = event.clientX - rect.left + lane.scrollLeft;
    const newMs = snap((x / zoomPxPerSec) * 1000);
    setPlayheadMs(newMs);
  }

  async function onDropClip(event: DragEvent<HTMLDivElement>, trackId: string) {
    event.preventDefault();
    const clipId = event.dataTransfer.getData("text/clip-id");
    if (!clipId) return;

    const lane = event.currentTarget;
    const rect = lane.getBoundingClientRect();
    const x = event.clientX - rect.left + lane.scrollLeft;
    const timelineStartMs = snap((x / zoomPxPerSec) * 1000);

    await patch([{ type: "move_clip", clipId, trackId, timelineStartMs }]);
    setSelectedTrack(trackId);
  }

  return (
    <section className="panel timeline-panel">
      <header className="panel-header panel-header-row">
        <h2>Timeline</h2>
        <div className="button-row">
          <button onClick={() => void addTrack("video")} type="button">
            + Video Track
          </button>
          <button onClick={() => void addTrack("audio")} type="button">
            + Audio Track
          </button>
        </div>
      </header>

      <div className="timeline-toolbar">
        <label>
          Zoom
          <input
            max={300}
            min={40}
            onChange={(event) => setZoomPxPerSec(Number(event.currentTarget.value))}
            type="range"
            value={zoomPxPerSec}
          />
        </label>
        <label>
          Playhead
          <input
            max={maxDurationMs}
            min={0}
            onChange={(event) => setPlayheadMs(Number(event.currentTarget.value))}
            type="range"
            value={Math.min(playheadMs, maxDurationMs)}
          />
        </label>
        <div className="muted">{msToLabel(playheadMs)}</div>
      </div>

      <div className="timeline-scroller">
        <div className="timeline-ruler" style={{ width: timelineWidth }}>
          {Array.from({ length: rulerTicks + 1 }).map((_, i) => (
            <div className="timeline-tick" key={i} style={{ left: i * zoomPxPerSec }}>
              <span>{i}s</span>
            </div>
          ))}
        </div>

        {timeline.tracks.map((track) => {
          const clips = clipsByTrack.get(track.id) ?? [];
          return (
            <div className="track-row" key={track.id}>
              <div className={`track-header ${selectedTrackId === track.id ? "selected" : ""}`}>
                <button onClick={() => setSelectedTrack(track.id)} type="button">
                  {track.name}
                </button>
                <span className="muted">{track.kind}</span>
                <div className="button-row">
                  <button onClick={() => void reorderTrack(track, "up")} type="button">
                    Up
                  </button>
                  <button onClick={() => void reorderTrack(track, "down")} type="button">
                    Down
                  </button>
                  <button onClick={() => void patch([{ type: "remove_track", trackId: track.id }])} type="button">
                    Remove
                  </button>
                </div>
              </div>

              <div
                className="track-lane"
                onClick={handleLaneClick}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => void onDropClip(event, track.id)}
                style={{ width: timelineWidth }}
              >
                <div
                  className="playhead"
                  style={{ left: (Math.min(playheadMs, maxDurationMs) / 1000) * zoomPxPerSec }}
                />
                {clips.map((clip) => {
                  const left = (clip.timelineStartMs / 1000) * zoomPxPerSec;
                  const width = (clipDurationMs(clip) / 1000) * zoomPxPerSec;
                  const isSelected = clip.id === selectedClipId;
                  return (
                    <button
                      className={`clip ${isSelected ? "selected" : ""}`}
                      draggable
                      key={clip.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedClip(clip.id);
                        setSelectedTrack(clip.trackId);
                      }}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/clip-id", clip.id);
                      }}
                      style={{ left, width }}
                      type="button"
                    >
                      <span>{msToLabel(clipDurationMs(clip))}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="clip-inspector">
        <div className="label">Clip Inspector</div>
        {!selectedClip && <div className="muted">Select a clip to trim/split/delete.</div>}
        {selectedClip && (
          <>
            <div className="muted">Clip ID: {selectedClip.id}</div>
            <label>
              Source In (ms)
              <input
                min={0}
                onChange={(event) => setTrimInMs(Number(event.currentTarget.value))}
                type="number"
                value={trimInMs}
              />
            </label>
            <label>
              Source Out (ms)
              <input
                min={trimInMs + 1}
                onChange={(event) => setTrimOutMs(Number(event.currentTarget.value))}
                type="number"
                value={trimOutMs}
              />
            </label>
            <div className="button-row">
              <button onClick={() => void trimSelectedClip()} type="button">
                Apply Trim
              </button>
              <button onClick={() => void splitClip()} type="button">
                Split @ Playhead
              </button>
              <button onClick={() => void deleteSelectedClip()} type="button">
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
