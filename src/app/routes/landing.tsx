import { useEffect, useState } from "react";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "react-router-dom";
import { createProject, deleteProject, listProjects, openProjectByRoot } from "../lib/desktopApi";
import type { ProjectCard } from "../types/editor";

export function LandingRoute() {
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState("Videre Project");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [recentProjects, setRecentProjects] = useState<ProjectCard[]>([]);

  const loadRecent = async () => {
    try {
      const projects = await listProjects();
      setRecentProjects(projects);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load projects");
    }
  };

  useEffect(() => {
    void loadRecent();
  }, []);

  async function handleCreate() {
    const folder = await open({ directory: true, multiple: false, title: "Choose parent folder" });
    if (!folder || Array.isArray(folder)) return;
    setLoading(true);
    setErrorMessage(undefined);
    try {
      const state = await createProject(projectName.trim() || "Videre Project", folder);
      navigate(`/project/${state.summary.id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create project");
    } finally {
      setLoading(false);
    }
  }

  async function handleOpen() {
    const folder = await open({ directory: true, multiple: false, title: "Select project folder" });
    if (!folder || Array.isArray(folder)) return;
    setLoading(true);
    setErrorMessage(undefined);
    try {
      const state = await openProjectByRoot(folder);
      navigate(`/project/${state.summary.id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to open project");
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenRecent(project: ProjectCard) {
    setLoading(true);
    setErrorMessage(undefined);
    try {
      const state = await openProjectByRoot(project.rootPath);
      navigate(`/project/${state.summary.id}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to open recent project");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteProject(project: ProjectCard) {
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
    setLoading(true);
    setErrorMessage(undefined);
    try {
      await deleteProject(project.id);
      await loadRecent();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete project");
    } finally {
      setLoading(false);
    }
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
          <div className="home-btn-row">
            <button disabled={loading} onClick={() => navigate("/projects")} type="button">
              Projects Dashboard
            </button>
          </div>
        </div>

        {errorMessage && <div className="home-error">{errorMessage}</div>}

        {recentProjects.length > 0 && (
          <div className="home-section">
            <div className="home-label">Recent</div>
            <div className="recent-list">
              {recentProjects.map((project) => (
                <div className="recent-item-row" key={project.id}>
                  <button
                    className="recent-item"
                    disabled={loading}
                    onClick={() => void handleOpenRecent(project)}
                    type="button"
                  >
                    <span className="recent-name">{project.name}</span>
                    <span className="recent-path">{project.rootPath}</span>
                  </button>
                  <button
                    className="recent-delete"
                    disabled={loading}
                    onClick={() => void handleDeleteProject(project)}
                    title={`Delete ${project.name}`}
                    aria-label={`Delete ${project.name}`}
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
