import { useCallback, useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import { Toolbar } from "./Toolbar";
import { LeftPanel } from "./LeftPanel";
import { ResizeHandle } from "./ResizeHandle";
import { VideoPreview } from "./VideoPreview";
import { Timeline } from "./Timeline";
import { usePlayback } from "./usePlayback";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

const DEFAULT_LEFT_WIDTH = 280;
const MIN_LEFT_WIDTH = 200;
const MAX_LEFT_WIDTH = 450;
const DEFAULT_PREVIEW_RATIO = 0.6; // 60% preview, 40% timeline
const MIN_PREVIEW_RATIO = 0.3;
const MAX_PREVIEW_RATIO = 0.8;

export function EditorLayout() {
  const renderJob = useEditorStore((s) => s.renderJob);

  usePlayback();
  useKeyboardShortcuts();

  const [leftWidth, setLeftWidth] = useState(
    () => Number(localStorage.getItem("videre-left-width")) || DEFAULT_LEFT_WIDTH,
  );
  const [previewRatio, setPreviewRatio] = useState(
    () => Number(localStorage.getItem("videre-preview-ratio")) || DEFAULT_PREVIEW_RATIO,
  );

  const handleLeftResize = useCallback((delta: number) => {
    setLeftWidth((prev) => {
      const next = Math.min(MAX_LEFT_WIDTH, Math.max(MIN_LEFT_WIDTH, prev + delta));
      localStorage.setItem("videre-left-width", String(next));
      return next;
    });
  }, []);

  const handleVerticalResize = useCallback((delta: number) => {
    const mainEl = document.querySelector(".editor-main");
    if (!mainEl) return;
    const mainHeight = mainEl.clientHeight;
    if (mainHeight <= 0) return;

    setPreviewRatio((prev) => {
      const next = Math.min(MAX_PREVIEW_RATIO, Math.max(MIN_PREVIEW_RATIO, prev + delta / mainHeight));
      localStorage.setItem("videre-preview-ratio", String(next));
      return next;
    });
  }, []);

  return (
    <div className="editor-shell">
      <Toolbar />

      <div className="editor-body">
        <div className="left-panel-wrapper" style={{ width: leftWidth }}>
          <LeftPanel />
        </div>

        <ResizeHandle direction="horizontal" onResize={handleLeftResize} />

        <div className="editor-main">
          <div className="editor-preview-wrapper" style={{ flex: previewRatio }}>
            <VideoPreview />
          </div>

          <ResizeHandle direction="vertical" onResize={handleVerticalResize} />

          <div className="editor-timeline-wrapper" style={{ flex: 1 - previewRatio }}>
            <Timeline />
          </div>
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
