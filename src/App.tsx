import { useEffect, useState } from "react";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import {
  onImportDone,
  onImportFailed,
  onImportProgress,
  onRenderDone,
  onRenderFailed,
  onRenderProgress,
} from "./lib/ipc";
import { EditorLayout } from "./features/editor/EditorLayout";
import { useEditorStore } from "./store/editorStore";
import type { ProjectSummary } from "./types/domain";
import "./App.css";

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
                    aria-label={`Delete ${p.name}`}
                    type="button"
                  >
                    <svg className="trash-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        className="trash-lid"
                        d="M9 4h6a1 1 0 0 1 .9.6L16.5 6H20a1 1 0 1 1 0 2H4a1 1 0 1 1 0-2h3.5l.6-1.4A1 1 0 0 1 9 4Z"
                      />
                      <path
                        className="trash-can"
                        d="M6.8 8h10.4l-.8 11a2 2 0 0 1-2 1.9H9.6a2 2 0 0 1-2-1.9L6.8 8Z"
                      />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
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
  return <EditorLayout />;
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
