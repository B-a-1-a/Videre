import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EditorLayout } from "../../features/editor/EditorLayout";
import { listProjects } from "../lib/desktopApi";
import { useEditorStore } from "../../store/editorStore";

export function ProjectRoute() {
  const navigate = useNavigate();
  const { id } = useParams();
  const currentProject = useEditorStore((s) => s.currentProject);
  const openProject = useEditorStore((s) => s.openProject);
  const errorMessage = useEditorStore((s) => s.errorMessage);
  const [loading, setLoading] = useState(true);
  const [routeError, setRouteError] = useState<string | undefined>();

  const needsOpen = useMemo(() => !currentProject || currentProject.id !== id, [currentProject, id]);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      navigate("/");
      return;
    }
    if (!needsOpen) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setRouteError(undefined);
    void (async () => {
      try {
        const projects = await listProjects();
        const target = projects.find((project) => project.id === id);
        if (!target) {
          throw new Error("Project was not found in recent projects. Open it from landing first.");
        }
        await openProject(target.rootPath);
      } catch (error) {
        if (!cancelled) {
          setRouteError(error instanceof Error ? error.message : "Failed to open project.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, needsOpen, navigate, openProject]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-zinc-400">
        Opening project...
      </div>
    );
  }

  if (routeError || errorMessage) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="home-card">
          <h2>Unable to open project</h2>
          <p className="text-sm text-zinc-400">{routeError ?? errorMessage}</p>
          <button onClick={() => navigate("/")} type="button">
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return <EditorLayout />;
}
