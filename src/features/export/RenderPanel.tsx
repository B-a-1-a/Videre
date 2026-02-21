import { useEffect, useState } from "react";
import { useBrowserRenderer } from "@twick/browser-render";
import { useEditorStore } from "../../store/editorStore";

export function RenderPanel() {
  const currentProject = useEditorStore((state) => state.currentProject);
  const renderJob = useEditorStore((state) => state.renderJob);
  const twickGetTimelineData = useEditorStore((state) => state.twickGetTimelineData);
  const startRender = useEditorStore((state) => state.startRender);
  const pollRenderStatus = useEditorStore((state) => state.pollRenderStatus);
  const cancelRender = useEditorStore((state) => state.cancelRender);

  const [outputName, setOutputName] = useState("output.mp4");

  // Browser renderer (quick export via WebCodecs — saves to Downloads)
  const {
    render,
    progress: browserProgress,
    isRendering,
    error: browserError,
    videoBlob,
    download,
    reset: resetBrowser,
  } = useBrowserRenderer({ width: 1920, height: 1080 });

  // FFmpeg render polling
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

  async function handleBrowserRender() {
    if (!twickGetTimelineData) return;
    const timelineData = twickGetTimelineData();
    if (!timelineData) return;
    await render({ input: timelineData });
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Export</h2>
      </header>

      <label>
        Output Name
        <input
          onChange={(event) => setOutputName(event.currentTarget.value)}
          placeholder="output.mp4"
          value={outputName}
        />
      </label>

      <div className="button-row">
        <button
          disabled={!currentProject || !twickGetTimelineData || isRendering}
          onClick={() => void handleBrowserRender()}
          title="In-browser render via WebCodecs — saves to Downloads"
          type="button"
        >
          Quick Export
        </button>
        <button
          disabled={
            !currentProject ||
            isRendering ||
            (!!renderJob && (renderJob.status === "running" || renderJob.status === "queued"))
          }
          onClick={() => void startRender({ outputName })}
          title="Full-quality FFmpeg render — saves to project exports folder"
          type="button"
        >
          Full Quality
        </button>
      </div>

      {isRendering && (
        <div className="render-status">
          <div className="label">Quick Export</div>
          <div>Progress: {(browserProgress * 100).toFixed(0)}%</div>
          <button onClick={resetBrowser} type="button">
            Cancel
          </button>
        </div>
      )}

      {videoBlob && !isRendering && (
        <div className="render-status">
          <div className="label">Quick Export done</div>
          <div className="button-row">
            <button onClick={() => download(outputName)} type="button">
              Download
            </button>
            <button onClick={resetBrowser} type="button">
              Clear
            </button>
          </div>
        </div>
      )}

      {browserError && <div className="error">{browserError.message}</div>}

      {renderJob && (
        <div className="render-status">
          <div className="label">Full Quality Render</div>
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

      {!renderJob && !isRendering && !videoBlob && <div className="muted">No render in progress.</div>}
    </section>
  );
}
