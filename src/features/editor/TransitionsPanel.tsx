import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import type { TransitionType } from "../../types/domain";

const TRANSITION_TYPES: { id: TransitionType; label: string; description: string }[] = [
  { id: "fade", label: "Fade", description: "Crossfade between clips" },
  { id: "slide", label: "Slide", description: "Slide next clip over previous" },
  { id: "wipe", label: "Wipe", description: "Wipe transition from left" },
  { id: "flip", label: "Flip", description: "Flip rotation effect" },
  { id: "clockwipe", label: "Clock Wipe", description: "Circular clock reveal" },
  { id: "iris", label: "Iris", description: "Circular iris from center" },
];

export function TransitionsPanel() {
  const timeline = useEditorStore((s) => s.timeline);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const addTransition = useEditorStore((s) => s.addTransition);
  const deleteTransition = useEditorStore((s) => s.deleteTransition);

  const [selectedType, setSelectedType] = useState<TransitionType>("fade");
  const [durationMs, setDurationMs] = useState(500);

  // Find if the selected clip can have a transition applied
  const selectedClip = timeline?.clips.find((c) => c.id === selectedClipId);

  // Find the next clip on the same track (adjacent)
  const nextClip = selectedClip
    ? timeline?.clips
        .filter((c) => c.trackId === selectedClip.trackId && c.id !== selectedClip.id)
        .sort((a, b) => a.timelineStartMs - b.timelineStartMs)
        .find((c) => c.timelineStartMs >= selectedClip.timelineStartMs + (selectedClip.sourceOutMs - selectedClip.sourceInMs))
    : undefined;

  // Check if a transition already exists from selected clip
  const existingTransition = selectedClip
    ? timeline?.transitions.find((t) => t.fromClipId === selectedClip.id)
    : undefined;

  async function handleApplyTransition() {
    if (!selectedClip || !nextClip) return;
    await addTransition(
      selectedClip.trackId,
      selectedClip.id,
      nextClip.id,
      selectedType,
      durationMs,
    );
  }

  async function handleRemoveTransition() {
    if (!existingTransition) return;
    await deleteTransition(existingTransition.id);
  }

  return (
    <div className="transitions-panel">
      <div className="transitions-grid">
        {TRANSITION_TYPES.map((t) => (
          <button
            key={t.id}
            className={`transition-card${selectedType === t.id ? " active" : ""}`}
            onClick={() => setSelectedType(t.id)}
            title={t.description}
            type="button"
          >
            <span className="transition-card-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="transitions-controls">
        <label className="text-editor-field">
          <span>Duration (ms)</span>
          <input
            type="number"
            min={100}
            max={3000}
            step={100}
            value={durationMs}
            onChange={(e) => setDurationMs(Number(e.target.value))}
          />
        </label>

        {selectedClip && nextClip && !existingTransition && (
          <button
            className="btn-primary"
            onClick={() => void handleApplyTransition()}
            type="button"
          >
            Apply {TRANSITION_TYPES.find((t) => t.id === selectedType)?.label} Transition
          </button>
        )}

        {existingTransition && (
          <div className="transitions-existing">
            <span className="transitions-existing-label">
              Active: {existingTransition.transitionType} ({existingTransition.durationMs}ms)
            </span>
            <button
              className="btn-danger"
              onClick={() => void handleRemoveTransition()}
              type="button"
            >
              Remove
            </button>
          </div>
        )}

        {selectedClip && !nextClip && (
          <div className="text-editor-hint">
            No adjacent clip found. Add another clip after this one to apply a transition.
          </div>
        )}

        {!selectedClip && (
          <div className="text-editor-hint">
            Select a clip on the timeline, then choose a transition type to apply between it and the next clip.
          </div>
        )}
      </div>
    </div>
  );
}
