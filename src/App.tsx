import { useEffect } from "react";
import {
  onImportDone,
  onImportFailed,
  onImportProgress,
  onRenderDone,
  onRenderFailed,
  onRenderProgress,
} from "./lib/ipc";
import { ProjectPanel } from "./features/projects/ProjectPanel";
import { MediaBin } from "./features/media-bin/MediaBin";
import { TimelineEditor } from "./features/timeline/TimelineEditor";
import { RenderPanel } from "./features/export/RenderPanel";
import { useEditorStore } from "./store/editorStore";
import "./App.css";

function App() {
  const currentProject = useEditorStore((state) => state.currentProject);
  const loading = useEditorStore((state) => state.loading);
  const statusMessage = useEditorStore((state) => state.statusMessage);
  const errorMessage = useEditorStore((state) => state.errorMessage);

  const loadRecentProjects = useEditorStore((state) => state.loadRecentProjects);
  const saveProject = useEditorStore((state) => state.saveProject);
  const openProject = useEditorStore((state) => state.openProject);
  const updateImportProgress = useEditorStore((state) => state.updateImportProgress);
  const pollRenderStatus = useEditorStore((state) => state.pollRenderStatus);

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
      const snapshotProject = useEditorStore.getState().currentProject;
      if (snapshotProject && snapshotProject.id === event.projectId) {
        void openProject(snapshotProject.rootPath);
      }
    }).then((dispose) => {
      unlistenDone = dispose;
    });

    void onImportFailed((event) => {
      updateImportProgress(event.assetId, 1);
    }).then((dispose) => {
      unlistenFailed = dispose;
    });

    void onRenderProgress(() => {
      void pollRenderStatus();
    }).then((dispose) => {
      unlistenRenderProgress = dispose;
    });

    void onRenderDone(() => {
      void pollRenderStatus();
    }).then((dispose) => {
      unlistenRenderDone = dispose;
    });

    void onRenderFailed(() => {
      void pollRenderStatus();
    }).then((dispose) => {
      unlistenRenderFailed = dispose;
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-main">
          <h1>Videre</h1>
          <div className="muted">Local-first video editor</div>
        </div>
        <div className="button-row">
          <button disabled={!currentProject || loading} onClick={() => void saveProject()} type="button">
            Save Project
          </button>
        </div>
      </header>

      <div className="status-strip">
        {statusMessage && <span>{statusMessage}</span>}
        {errorMessage && <span className="error">{errorMessage}</span>}
      </div>

      <div className="workspace">
        <aside className="sidebar">
          <ProjectPanel />
          <MediaBin />
          <RenderPanel />
        </aside>

        <section className="main-content">
          <TimelineEditor />
        </section>
      </div>
    </main>
  );
}

export default App;
