import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getStorageStats, listProjects } from "../lib/desktopApi";
import { useEditorStore } from "../../store/editorStore";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[idx]}`;
}

export function ProfileRoute() {
  const navigate = useNavigate();
  const currentProject = useEditorStore((s) => s.currentProject);
  const [projectCount, setProjectCount] = useState<number>(0);
  const [usedBytes, setUsedBytes] = useState(0);
  const [limitBytes, setLimitBytes] = useState(2 * 1024 * 1024 * 1024);

  useEffect(() => {
    void (async () => {
      const projects = await listProjects();
      setProjectCount(projects.length);
    })();
  }, []);

  useEffect(() => {
    if (!currentProject) return;
    void (async () => {
      try {
        const stats = await getStorageStats(currentProject.id);
        setUsedBytes(stats.usedBytes);
        setLimitBytes(stats.limitBytes);
      } catch {
        setUsedBytes(0);
      }
    })();
  }, [currentProject]);

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Profile</h1>
          <button onClick={() => navigate(-1)} type="button">
            Back
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="border border-zinc-700 rounded-xl p-4 bg-zinc-900/60">
            <div className="text-sm text-zinc-400">Mode</div>
            <div className="text-lg font-semibold mt-1">Local single-user</div>
          </div>
          <div className="border border-zinc-700 rounded-xl p-4 bg-zinc-900/60">
            <div className="text-sm text-zinc-400">Projects</div>
            <div className="text-lg font-semibold mt-1">{projectCount}</div>
          </div>
          <div className="border border-zinc-700 rounded-xl p-4 bg-zinc-900/60">
            <div className="text-sm text-zinc-400">Storage</div>
            <div className="text-lg font-semibold mt-1">
              {formatBytes(usedBytes)} / {formatBytes(limitBytes)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
