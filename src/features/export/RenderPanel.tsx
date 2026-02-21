import { useEffect, useState } from "react";
import { useEditorStore } from "../../store/editorStore";

export function RenderPanel() {
  const currentProject = useEditorStore((state) => state.currentProject);
  const renderJob = useEditorStore((state) => state.renderJob);
  const startRender = useEditorStore((state) => state.startRender);
  const pollRenderStatus = useEditorStore((state) => state.pollRenderStatus);
  const cancelRender = useEditorStore((state) => state.cancelRender);

  const [outputName, setOutputName] = useState("output.mp4");

  useEffect(() => {
    if (!renderJob) return;
    if (renderJob.status === "done" || renderJob.status === "failed" || renderJob.status === "canceled") {
      return;
    }

    const interval = window.setInterval(() => {
      void pollRenderStatus();
    }, 1500);

    return () => window.clearInterval(interval);
  }, [pollRenderStatus, renderJob]);

  return (
    <section className="panel">
      <header className="panel-header panel-header-row">
        <h2>Export</h2>
        <button
          disabled={!currentProject}
          onClick={() => void startRender({ outputName })}
          type="button"
        >
          Render MP4
        </button>
      </header>

      <label>
        Output Name
        <input
          onChange={(event) => setOutputName(event.currentTarget.value)}
          placeholder="output.mp4"
          value={outputName}
        />
      </label>

      {!renderJob && <div className="muted">No render in progress.</div>}

      {renderJob && (
        <div className="render-status">
          <div className="label">Current Job</div>
          <div>ID: {renderJob.id}</div>
          <div>Status: {renderJob.status}</div>
          <div>Progress: {(renderJob.progress * 100).toFixed(0)}%</div>
          {renderJob.outputPath && <div className="muted">Output: {renderJob.outputPath}</div>}
          {renderJob.error && <div className="error">{renderJob.error}</div>}

          <div className="button-row">
            <button onClick={() => void pollRenderStatus()} type="button">
              Refresh
            </button>
            <button
              disabled={renderJob.status !== "running" && renderJob.status !== "queued"}
              onClick={() => void cancelRender()}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
