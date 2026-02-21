import { useEditorStore } from "../../store/editorStore";
import { Toolbar } from "./Toolbar";
import { MediaPanel } from "./MediaPanel";
import { ClipInspector } from "./ClipInspector";
import { VideoPreview } from "./VideoPreview";
import { Timeline } from "./Timeline";
import { usePlayback } from "./usePlayback";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

export function EditorLayout() {
  const renderJob = useEditorStore((s) => s.renderJob);

  usePlayback();
  useKeyboardShortcuts();

  return (
    <div className="editor-shell">
      <Toolbar />

      <div className="editor-body">
        {/* Left panel: media + inspector */}
        <div className="left-panel">
          <MediaPanel />
          <ClipInspector />
        </div>

        {/* Main area: preview + timeline */}
        <div className="editor-main">
          <VideoPreview />
          <Timeline />
        </div>
      </div>

      {/* Render toasts */}
      {renderJob?.status === "done" && renderJob.outputPath && (
        <div className="export-toast">
          <span>Render saved: {renderJob.outputPath}</span>
        </div>
      )}
      {renderJob?.status === "failed" && renderJob.error && (
        <div className="export-toast export-toast--error">
          <span>Render failed: {renderJob.error}</span>
        </div>
      )}
    </div>
  );
}
