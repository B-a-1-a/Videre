import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import type { TextOverlay } from "../../types/domain";

const FONT_FAMILIES = ["Arial", "Helvetica", "Times New Roman", "Georgia", "Verdana", "Impact", "Courier New"];
const FONT_WEIGHTS = ["normal", "bold"];
const TEXT_ALIGNS = ["left", "center", "right"];

export function TextEditorPanel() {
  const timeline = useEditorStore((s) => s.timeline);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedTrackId = useEditorStore((s) => s.selectedTrackId);
  const playheadMs = useEditorStore((s) => s.playheadMs);
  const addTextClip = useEditorStore((s) => s.addTextClip);
  const updateTextOverlay = useEditorStore((s) => s.updateTextOverlay);

  const [newText, setNewText] = useState("Hello World");

  // Find the text overlay for the selected clip
  const selectedOverlay: TextOverlay | undefined = timeline?.textOverlays.find(
    (o) => o.clipId === selectedClipId,
  );

  const selectedClip = timeline?.clips.find((c) => c.id === selectedClipId);
  const isTextClip = selectedClip?.assetId === "__text__";

  async function handleAddText() {
    // Find a video track to add text to
    const trackId = selectedTrackId ?? timeline?.tracks.find((t) => t.kind === "video")?.id;
    if (!trackId) return;
    await addTextClip(trackId, playheadMs, newText);
  }

  async function handleUpdate(field: string, value: unknown) {
    if (!selectedClipId || !selectedOverlay) return;
    await updateTextOverlay(selectedClipId, { [field]: value });
  }

  return (
    <div className="text-editor-panel">
      <div className="text-editor-add">
        <input
          className="text-add-input"
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Text content..."
        />
        <button className="btn-primary" onClick={() => void handleAddText()} type="button">
          + Add Text
        </button>
      </div>

      {isTextClip && selectedOverlay ? (
        <div className="text-editor-fields">
          <div className="text-editor-section-label">Edit Text Overlay</div>

          <label className="text-editor-field">
            <span>Content</span>
            <textarea
              value={selectedOverlay.content}
              onChange={(e) => void handleUpdate("content", e.target.value)}
              rows={2}
            />
          </label>

          <label className="text-editor-field">
            <span>Font</span>
            <select
              value={selectedOverlay.fontFamily}
              onChange={(e) => void handleUpdate("fontFamily", e.target.value)}
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>

          <label className="text-editor-field">
            <span>Size</span>
            <input
              type="number"
              min={8}
              max={200}
              value={selectedOverlay.fontSize}
              onChange={(e) => void handleUpdate("fontSize", Number(e.target.value))}
            />
          </label>

          <label className="text-editor-field">
            <span>Color</span>
            <input
              type="color"
              value={selectedOverlay.fontColor}
              onChange={(e) => void handleUpdate("fontColor", e.target.value)}
            />
          </label>

          <label className="text-editor-field">
            <span>Weight</span>
            <select
              value={selectedOverlay.fontWeight}
              onChange={(e) => void handleUpdate("fontWeight", e.target.value)}
            >
              {FONT_WEIGHTS.map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </label>

          <label className="text-editor-field">
            <span>Align</span>
            <select
              value={selectedOverlay.textAlign}
              onChange={(e) => void handleUpdate("textAlign", e.target.value)}
            >
              {TEXT_ALIGNS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>

          <label className="text-editor-field">
            <span>X Position</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={selectedOverlay.positionX}
              onChange={(e) => void handleUpdate("positionX", Number(e.target.value))}
            />
          </label>

          <label className="text-editor-field">
            <span>Y Position</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={selectedOverlay.positionY}
              onChange={(e) => void handleUpdate("positionY", Number(e.target.value))}
            />
          </label>
        </div>
      ) : (
        <div className="text-editor-hint">
          Select a text clip to edit its properties
        </div>
      )}
    </div>
  );
}
