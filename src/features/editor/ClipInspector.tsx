import { useEffect, useState } from "react";
import { useEditorStore, getSelectedClip } from "../../store/editorStore";

export function ClipInspector() {
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const timeline = useEditorStore((s) => s.timeline);
  const assets = useEditorStore((s) => s.assets);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const applyTimelinePatch = useEditorStore((s) => s.applyTimelinePatch);
  const setSelectedClip = useEditorStore((s) => s.setSelectedClip);

  const clip = getSelectedClip({ timeline, selectedClipId });
  const asset = clip ? assets.find((a) => a.id === clip.assetId) : undefined;

  const [trimIn, setTrimIn] = useState(0);
  const [trimOut, setTrimOut] = useState(0);

  useEffect(() => {
    if (clip) {
      setTrimIn(clip.sourceInMs);
      setTrimOut(clip.sourceOutMs);
    }
  }, [clip]);

  if (!clip) {
    return (
      <div className="clip-inspector">
        <div className="inspector-empty">Select a clip to inspect</div>
      </div>
    );
  }

  const duration = trimOut - trimIn;

  function handleApplyTrim() {
    if (!clip) return;
    void applyTimelinePatch([
      { type: "trim_clip", clipId: clip.id, sourceInMs: trimIn, sourceOutMs: trimOut },
    ]);
  }

  function handleSplit() {
    if (!clip) return;
    // Only split if playhead is within the clip's timeline range
    const clipEnd = clip.timelineStartMs + (clip.sourceOutMs - clip.sourceInMs);
    if (playheadMs > clip.timelineStartMs && playheadMs < clipEnd) {
      void applyTimelinePatch([{ type: "split_clip", clipId: clip.id, atTimelineMs: playheadMs }]);
    }
  }

  function handleDelete() {
    if (!clip) return;
    void applyTimelinePatch([{ type: "delete_clip", clipId: clip.id }]);
    setSelectedClip(undefined);
  }

  return (
    <div className="clip-inspector">
      <div className="inspector-header">Clip Inspector</div>
      <div className="inspector-fields">
        <div className="inspector-field">
          <label>File</label>
          <span className="inspector-value">{asset?.fileName ?? "—"}</span>
        </div>
        <div className="inspector-field">
          <label>Position</label>
          <span className="inspector-value">{clip.timelineStartMs} ms</span>
        </div>
        <div className="inspector-field">
          <label>In</label>
          <input
            type="number"
            value={trimIn}
            min={0}
            step={10}
            onChange={(e) => setTrimIn(Number(e.target.value))}
          />
        </div>
        <div className="inspector-field">
          <label>Out</label>
          <input
            type="number"
            value={trimOut}
            min={trimIn}
            step={10}
            onChange={(e) => setTrimOut(Number(e.target.value))}
          />
        </div>
        <div className="inspector-field">
          <label>Duration</label>
          <span className="inspector-value">{duration} ms</span>
        </div>
        <div className="inspector-actions">
          <button onClick={handleApplyTrim} type="button">Apply Trim</button>
          <button onClick={handleSplit} type="button">Split at Playhead</button>
          <button className="btn-danger" onClick={handleDelete} type="button">Delete</button>
        </div>
      </div>
    </div>
  );
}
