import { useEffect, useMemo, useState } from "react";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "react-router-dom";
import { createProject, deleteProject, listProjects, openProjectByRoot, renameProject } from "../lib/desktopApi";
import type { ProjectCard } from "../types/editor";

type SortMode = "created_desc" | "created_asc" | "name_asc" | "name_desc";

export function ProjectsRoute() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [sortBy, setSortBy] = useState<SortMode>("created_desc");

  const refresh = async () => {
    setLoading(true);
    setErrorMessage(undefined);
    try {
      setProjects(await listProjects());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const sortedProjects = useMemo(() => {
    const items = [...projects];
    switch (sortBy) {
      case "name_asc":
        return items.sort((a, b) => a.name.localeCompare(b.name));
      case "name_desc":
        return items.sort((a, b) => b.name.localeCompare(a.name));
      case "created_asc":
        return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      default:
        return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
  }, [projects, sortBy]);

  const createFromPicker = async () => {
    const folder = await open({ directory: true, multiple: false, title: "Choose parent folder" });
    if (!folder || Array.isArray(folder)) return;
    const name = prompt("Project name", "Untitled Project")?.trim() || "Untitled Project";
    const state = await createProject(name, folder);
    navigate(`/project/${state.summary.id}`);
  };

  const openFolder = async () => {
    const folder = await open({ directory: true, multiple: false, title: "Select project folder" });
    if (!folder || Array.isArray(folder)) return;
    const state = await openProjectByRoot(folder);
    navigate(`/project/${state.summary.id}`);
  };

  const onRename = async (project: ProjectCard) => {
    const nextName = prompt("Rename project", project.name)?.trim();
    if (!nextName || nextName === project.name) return;
    await renameProject(project.id, nextName);
    await refresh();
  };

  const onDelete = async (project: ProjectCard) => {
    const approved = await confirm(`Delete '${project.name}'?`, {
      title: "Delete project",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!approved) return;
    await deleteProject(project.id);
    await refresh();
  };

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6 gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Projects</h1>
            <p className="text-zinc-400 text-sm">Local-first dashboard (Klyp shell on Tauri runtime)</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => navigate("/")} type="button">
              Home
            </button>
            <button className="btn-primary" onClick={() => void createFromPicker()} type="button">
              New Project
            </button>
            <button onClick={() => void openFolder()} type="button">
              Open Folder
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-zinc-400">Sort:</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.currentTarget.value as SortMode)}>
            <option value="created_desc">Newest first</option>
            <option value="created_asc">Oldest first</option>
            <option value="name_asc">Name A-Z</option>
            <option value="name_desc">Name Z-A</option>
          </select>
        </div>

        {errorMessage && <div className="home-error mb-4">{errorMessage}</div>}
        {loading ? (
          <div className="text-zinc-400">Loading projects...</div>
        ) : sortedProjects.length === 0 ? (
          <div className="text-zinc-400">No projects yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sortedProjects.map((project) => (
              <div
                key={project.id}
                className="border border-zinc-700 rounded-xl p-4 bg-zinc-900/60 cursor-pointer"
                onClick={() => navigate(`/project/${project.id}`)}
              >
                <div className="font-semibold">{project.name}</div>
                <div className="text-xs text-zinc-400 mt-1 truncate">{project.rootPath}</div>
                <div className="text-[11px] text-zinc-500 mt-2">
                  {new Date(project.createdAt).toLocaleString()}
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void onRename(project);
                    }}
                    type="button"
                  >
                    Rename
                  </button>
                  <button
                    className="btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onDelete(project);
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
