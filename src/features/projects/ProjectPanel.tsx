import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "../../store/editorStore";

export function ProjectPanel() {
  const [projectName, setProjectName] = useState("Videre Project");

  const loading = useEditorStore((state) => state.loading);
  const currentProject = useEditorStore((state) => state.currentProject);
  const recentProjects = useEditorStore((state) => state.recentProjects);
  const loadRecentProjects = useEditorStore((state) => state.loadRecentProjects);
  const createProject = useEditorStore((state) => state.createProject);
  const openProject = useEditorStore((state) => state.openProject);
  const openProjectBySummary = useEditorStore((state) => state.openProjectBySummary);

  useEffect(() => {
    void loadRecentProjects();
  }, [loadRecentProjects]);

  async function handleCreateProject() {
    const folder = await open({ directory: true, multiple: false, title: "Choose parent folder" });
    if (!folder || Array.isArray(folder)) return;

    await createProject(projectName.trim() || "Videre Project", folder);
  }

  async function handleOpenProject() {
    const folder = await open({ directory: true, multiple: false, title: "Select project folder" });
    if (!folder || Array.isArray(folder)) return;

    await openProject(folder);
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Project</h2>
      </header>

      <div className="project-controls">
        <label htmlFor="project-name">Name</label>
        <input
          id="project-name"
          value={projectName}
          onChange={(event) => setProjectName(event.currentTarget.value)}
          placeholder="Project name"
        />

        <div className="button-row">
          <button disabled={loading} onClick={handleCreateProject} type="button">
            New Project
          </button>
          <button disabled={loading} onClick={handleOpenProject} type="button">
            Open Project
          </button>
        </div>
      </div>

      {currentProject && (
        <div className="project-summary">
          <div className="label">Current</div>
          <div>{currentProject.name}</div>
          <div className="muted">{currentProject.rootPath}</div>
        </div>
      )}

      <div className="recent-projects">
        <div className="label">Recent</div>
        {recentProjects.length === 0 && <div className="muted">No recent projects yet.</div>}
        {recentProjects.map((project) => (
          <button
            className="recent-item"
            key={project.id}
            onClick={() => void openProjectBySummary(project)}
            type="button"
          >
            <span>{project.name}</span>
            <span className="muted">{project.rootPath}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
