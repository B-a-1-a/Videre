import { open } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "../../store/editorStore";
import { MIN_ZOOM_PX_PER_SEC, MAX_ZOOM_PX_PER_SEC } from "./constants";

export function Toolbar() {
  const currentProject = useEditorStore((s) => s.currentProject);
  const loading = useEditorStore((s) => s.loading);
  const statusMessage = useEditorStore((s) => s.statusMessage);
  const errorMessage = useEditorStore((s) => s.errorMessage);
  const renderJob = useEditorStore((s) => s.renderJob);
  const zoomPxPerSec = useEditorStore((s) => s.zoomPxPerSec);
  const closeProject = useEditorStore((s) => s.closeProject);
  const saveProject = useEditorStore((s) => s.saveProject);
  const importMedia = useEditorStore((s) => s.importMedia);
  const startRender = useEditorStore((s) => s.startRender);
  const cancelRender = useEditorStore((s) => s.cancelRender);
  const setZoomPxPerSec = useEditorStore((s) => s.setZoomPxPerSec);

  async function handleImport() {
    const filePaths = await open({
      multiple: true,
      title: "Import media",
      filters: [
        {
          name: "Media",
          extensions: ["mp4", "mov", "mkv", "mp3", "wav", "aac", "flac", "png", "jpg", "jpeg", "webp"],
        },
      ],
    });
    if (!filePaths) return;
    const normalized = Array.isArray(filePaths) ? filePaths : [filePaths];
    await importMedia(normalized);
  }

  const isFFmpegActive = !!renderJob && (renderJob.status === "running" || renderJob.status === "queued");

  return (
    <div className="editor-topbar">
      <div className="topbar-left">
        <button className="btn-back" onClick={closeProject} type="button">
          ← Projects
        </button>
        <span className="topbar-project">{currentProject?.name}</span>
      </div>

      <div className="topbar-center">
        {errorMessage && <span className="topbar-error">{errorMessage}</span>}
        {!errorMessage && statusMessage && <span className="topbar-status">{statusMessage}</span>}
      </div>

      <div className="topbar-right">
        <button disabled={loading} onClick={() => void handleImport()} type="button">
          Import
        </button>
        <button disabled={!currentProject || loading} onClick={() => void saveProject()} type="button">
          Save
        </button>
        <div className="topbar-sep" />
        <button
          disabled={isFFmpegActive}
          onClick={() => void startRender({ outputName: "output.mp4" })}
          title="Full-quality FFmpeg render"
          type="button"
        >
          {isFFmpegActive && renderJob ? `${(renderJob.progress * 100).toFixed(0)}%…` : "Export"}
        </button>
        {isFFmpegActive && (
          <button className="btn-danger" onClick={() => void cancelRender()} title="Cancel render" type="button">
            ✕
          </button>
        )}
        <div className="topbar-sep" />
        <label className="zoom-control" title="Timeline zoom">
          <span className="zoom-label">Zoom</span>
          <input
            type="range"
            min={MIN_ZOOM_PX_PER_SEC}
            max={MAX_ZOOM_PX_PER_SEC}
            value={zoomPxPerSec}
            onChange={(e) => setZoomPxPerSec(Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
