import { useEffect, useState } from "react";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { VideoElement, AudioElement, ImageElement } from "@twick/timeline";
import { useBrowserRenderer } from "@twick/browser-render";
import {
  onImportDone,
  onImportFailed,
  onImportProgress,
  onRenderDone,
  onRenderFailed,
  onRenderProgress,
} from "./lib/ipc";
import { TwickEditor } from "./features/timeline/TwickEditor";
import { useEditorStore } from "./store/editorStore";
import type { ProjectSummary } from "./types/domain";
import "./App.css";

const VIDEO_RESOLUTION = { width: 1920, height: 1080 };

// ---- Home screen (no project open) ----

function HomeView() {
  const [projectName, setProjectName] = useState("Videre Project");
  const loading = useEditorStore((s) => s.loading);
  const recentProjects = useEditorStore((s) => s.recentProjects);
  const errorMessage = useEditorStore((s) => s.errorMessage);
  const createProject = useEditorStore((s) => s.createProject);
  const openProject = useEditorStore((s) => s.openProject);
  const openProjectBySummary = useEditorStore((s) => s.openProjectBySummary);
  const deleteProject = useEditorStore((s) => s.deleteProject);

  async function handleCreate() {
    const folder = await open({ directory: true, multiple: false, title: "Choose parent folder" });
    if (!folder || Array.isArray(folder)) return;
    await createProject(projectName.trim() || "Videre Project", folder);
  }

  async function handleOpen() {
    const folder = await open({ directory: true, multiple: false, title: "Select project folder" });
    if (!folder || Array.isArray(folder)) return;
    await openProject(folder);
  }

  async function handleDeleteProject(project: ProjectSummary) {
    const approved = await confirm(
      `Delete '${project.name}'?\nThis permanently removes the project folder and all its files.`,
      {
        title: "Delete project",
        kind: "warning",
        okLabel: "Delete",
        cancelLabel: "Cancel",
      },
    );
    if (!approved) return;
    await deleteProject(project);
  }

  return (
    <div className="home-screen">
      <div className="home-card">
        <div className="home-brand">
          <h1>Videre</h1>
          <p>Local-first video editor</p>
        </div>

        <div className="home-section">
          <label className="home-label" htmlFor="proj-name">
            Project name
          </label>
          <input
            id="proj-name"
            onChange={(e) => setProjectName(e.currentTarget.value)}
            placeholder="My Project"
            value={projectName}
          />
          <div className="home-btn-row">
            <button className="btn-primary" disabled={loading} onClick={() => void handleCreate()} type="button">
              New Project
            </button>
            <button disabled={loading} onClick={() => void handleOpen()} type="button">
              Open Folder
            </button>
          </div>
        </div>

        {errorMessage && <div className="home-error">{errorMessage}</div>}

        {recentProjects.length > 0 && (
          <div className="home-section">
            <div className="home-label">Recent</div>
            <div className="recent-list">
              {recentProjects.map((p) => (
                <div className="recent-item-row" key={p.id}>
                  <button
                    className="recent-item"
                    disabled={loading}
                    onClick={() => void openProjectBySummary(p)}
                    type="button"
                  >
                    <span className="recent-name">{p.name}</span>
                    <span className="recent-path">{p.rootPath}</span>
                  </button>
                  <button
                    className="recent-delete"
                    disabled={loading}
                    onClick={() => void handleDeleteProject(p)}
                    title={`Delete ${p.name}`}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Editor view (project open) ----

function EditorView() {
  const currentProject = useEditorStore((s) => s.currentProject);
  const loading = useEditorStore((s) => s.loading);
  const statusMessage = useEditorStore((s) => s.statusMessage);
  const errorMessage = useEditorStore((s) => s.errorMessage);
  const assets = useEditorStore((s) => s.assets);
  const importProgressByAssetId = useEditorStore((s) => s.importProgressByAssetId);
  const twickAddElement = useEditorStore((s) => s.twickAddElement);
  const twickGetTimelineData = useEditorStore((s) => s.twickGetTimelineData);
  const saveProject = useEditorStore((s) => s.saveProject);
  const importMedia = useEditorStore((s) => s.importMedia);
  const removeAsset = useEditorStore((s) => s.removeAsset);
  const renderJob = useEditorStore((s) => s.renderJob);
  const startRender = useEditorStore((s) => s.startRender);
  const cancelRender = useEditorStore((s) => s.cancelRender);
  const closeProject = useEditorStore((s) => s.closeProject);

  const [showAssets, setShowAssets] = useState(false);
  const outputName = "output.mp4";

  const {
    render,
    progress: browserProgress,
    isRendering,
    error: browserError,
    videoBlob,
    download,
    reset: resetBrowser,
  } = useBrowserRenderer({ width: 1920, height: 1080 });

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
    setShowAssets(true);
  }

  async function handleAddToTimeline(assetId: string, assetKind: string) {
    if (!twickAddElement) return;
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;
    const url = convertFileSrc(asset.proxyPath ?? asset.managedPath);
    let element: VideoElement | AudioElement | ImageElement;
    if (assetKind === "video") {
      element = new VideoElement(url, VIDEO_RESOLUTION);
      if (asset.durationMs) element.setMediaDuration(asset.durationMs / 1000);
    } else if (assetKind === "audio") {
      element = new AudioElement(url);
      if (asset.durationMs) element.setMediaDuration(asset.durationMs / 1000);
    } else {
      element = new ImageElement(url, VIDEO_RESOLUTION);
    }
    await twickAddElement(element);
  }

  async function handleBrowserRender() {
    if (!twickGetTimelineData) return;
    const data = twickGetTimelineData();
    if (!data) return;
    await render({ input: data });
  }

  const isFFmpegActive = !!renderJob && (renderJob.status === "running" || renderJob.status === "queued");

  return (
    <div className="editor-shell">
      {/* Top bar */}
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
          <button
            className={`btn-assets${showAssets ? " active" : ""}`}
            onClick={() => setShowAssets((v) => !v)}
            type="button"
          >
            Media{assets.length > 0 ? ` (${assets.length})` : ""}
          </button>
          <button disabled={loading} onClick={() => void handleImport()} type="button">
            Import
          </button>
          <button disabled={!currentProject || loading} onClick={() => void saveProject()} type="button">
            Save
          </button>
          <div className="topbar-sep" />
          <button
            disabled={!twickGetTimelineData || isRendering}
            onClick={() => void handleBrowserRender()}
            title="In-browser WebCodecs render — saves to Downloads"
            type="button"
          >
            {isRendering ? `${(browserProgress * 100).toFixed(0)}%…` : "Quick Export"}
          </button>
          <button
            disabled={isRendering || isFFmpegActive}
            onClick={() => void startRender({ outputName })}
            title="Full-quality FFmpeg render"
            type="button"
          >
            {isFFmpegActive && renderJob ? `${(renderJob.progress * 100).toFixed(0)}%…` : "Full Quality"}
          </button>
          {isFFmpegActive && (
            <button className="btn-danger" onClick={() => void cancelRender()} title="Cancel render" type="button">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Editor body: optional assets panel + Twick Studio */}
      <div className="editor-body">
        {showAssets && (
          <div className="assets-panel">
            <div className="assets-panel-header">
              <span>Media Assets</span>
              <button className="btn-icon" onClick={() => setShowAssets(false)} type="button">
                ×
              </button>
            </div>
            <button
              className="assets-import-btn"
              disabled={loading}
              onClick={() => void handleImport()}
              type="button"
            >
              + Import Media
            </button>
            <div className="assets-list">
              {assets.length === 0 ? (
                <div className="assets-empty">No assets imported yet.</div>
              ) : (
                assets.map((asset) => {
                  const progress = importProgressByAssetId[asset.id];
                  const dur = asset.durationMs ? `${(asset.durationMs / 1000).toFixed(1)}s` : "—";
                  return (
                    <div className="asset-row" key={asset.id}>
                      <div className="asset-info">
                        <div className="asset-filename">{asset.fileName}</div>
                        <div className="asset-details">
                          {asset.kind} · {dur}
                        </div>
                        {typeof progress === "number" && progress < 1 && (
                          <div className="asset-progress-bar">
                            <div className="asset-progress-fill" style={{ width: `${progress * 100}%` }} />
                          </div>
                        )}
                      </div>
                      <div className="asset-btns">
                        <button onClick={() => void handleAddToTimeline(asset.id, asset.kind)} type="button">
                          Add
                        </button>
                        <button className="btn-danger" onClick={() => void removeAsset(asset.id)} type="button">
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        <div className="twick-wrapper">
          <TwickEditor />
        </div>
      </div>

      {/* Toast: quick export done */}
      {videoBlob && !isRendering && (
        <div className="export-toast">
          <span>Quick export ready</span>
          <button onClick={() => download(outputName)} type="button">
            Download
          </button>
          <button className="btn-icon" onClick={resetBrowser} type="button">
            ×
          </button>
        </div>
      )}

      {/* Toast: browser render error */}
      {browserError && (
        <div className="export-toast export-toast--error">
          <span>{browserError.message}</span>
          <button className="btn-icon" onClick={resetBrowser} type="button">
            ×
          </button>
        </div>
      )}

      {/* Toast: FFmpeg render done */}
      {renderJob?.status === "done" && renderJob.outputPath && (
        <div className="export-toast">
          <span>Render saved: {renderJob.outputPath}</span>
        </div>
      )}

      {/* Toast: FFmpeg render failed */}
      {renderJob?.status === "failed" && renderJob.error && (
        <div className="export-toast export-toast--error">
          <span>Render failed: {renderJob.error}</span>
        </div>
      )}
    </div>
  );
}

// ---- Root: IPC wiring + view routing ----

function App() {
  const currentProject = useEditorStore((s) => s.currentProject);
  const loadRecentProjects = useEditorStore((s) => s.loadRecentProjects);
  const openProject = useEditorStore((s) => s.openProject);
  const updateImportProgress = useEditorStore((s) => s.updateImportProgress);
  const pollRenderStatus = useEditorStore((s) => s.pollRenderStatus);

  useEffect(() => {
    void loadRecentProjects();
  }, [loadRecentProjects]);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenDone: (() => void) | undefined;
    let unlistenFailed: (() => void) | undefined;
    let unlistenRenderProgress: (() => void) | undefined;
    let unlistenRenderDone: (() => void) | undefined;
    let unlistenRenderFailed: (() => void) | undefined;

    void onImportProgress((event) => {
      updateImportProgress(event.assetId, event.progress);
    }).then((dispose) => {
      unlistenProgress = dispose;
    });

    void onImportDone((event) => {
      updateImportProgress(event.assetId, 1);
      const proj = useEditorStore.getState().currentProject;
      if (proj?.id === event.projectId) void openProject(proj.rootPath);
    }).then((dispose) => {
      unlistenDone = dispose;
    });

    void onImportFailed((event) => {
      updateImportProgress(event.assetId, 1);
    }).then((dispose) => {
      unlistenFailed = dispose;
    });

    void onRenderProgress(() => void pollRenderStatus()).then((d) => {
      unlistenRenderProgress = d;
    });
    void onRenderDone(() => void pollRenderStatus()).then((d) => {
      unlistenRenderDone = d;
    });
    void onRenderFailed(() => void pollRenderStatus()).then((d) => {
      unlistenRenderFailed = d;
    });

    return () => {
      unlistenProgress?.();
      unlistenDone?.();
      unlistenFailed?.();
      unlistenRenderProgress?.();
      unlistenRenderDone?.();
      unlistenRenderFailed?.();
    };
  }, [openProject, pollRenderStatus, updateImportProgress]);

  if (!currentProject) return <HomeView />;
  return <EditorView />;
}

export default App;
