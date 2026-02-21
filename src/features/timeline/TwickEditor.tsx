import { useCallback, useEffect, useMemo } from "react";
import { LivePlayerProvider } from "@twick/live-player";
import { TimelineProvider, INITIAL_TIMELINE_DATA } from "@twick/timeline";
import { TwickStudio, useEditorManager, useTimelineContext } from "@twick/studio";
import type { ProjectJSON } from "@twick/timeline";
import { useEditorStore } from "../../store/editorStore";

// Rendered inside the twick provider tree to bridge twick state to the rest of the app
function TwickBridge() {
  const { addElement } = useEditorManager();
  const { editor } = useTimelineContext();
  const setTwickAddElement = useEditorStore((s) => s.setTwickAddElement);
  const setTwickGetTimelineData = useEditorStore((s) => s.setTwickGetTimelineData);

  useEffect(() => {
    setTwickAddElement(addElement as (element: unknown) => Promise<void>);
    setTwickGetTimelineData(() => editor.getTimelineData());
    return () => {
      setTwickAddElement(null);
      setTwickGetTimelineData(null);
    };
  }, [addElement, editor, setTwickAddElement, setTwickGetTimelineData]);

  return null;
}

export function TwickEditor() {
  const currentProject = useEditorStore((s) => s.currentProject);
  const twickTimelineJson = useEditorStore((s) => s.twickTimelineJson);
  const saveTwickTimeline = useEditorStore((s) => s.saveTwickTimeline);

  const initialData = useMemo(() => {
    if (!twickTimelineJson) return INITIAL_TIMELINE_DATA;
    try {
      return JSON.parse(twickTimelineJson) as typeof INITIAL_TIMELINE_DATA;
    } catch {
      return INITIAL_TIMELINE_DATA;
    }
  }, [twickTimelineJson]);

  const handleSaveProject = useCallback(
    async (project: ProjectJSON): Promise<{ status: boolean; message: string }> => {
      if (!currentProject) return { status: false, message: "No project open" };
      await saveTwickTimeline(currentProject.id, JSON.stringify(project));
      return { status: true, message: "Saved" };
    },
    [currentProject, saveTwickTimeline],
  );

  if (!currentProject) {
    return (
      <div className="twick-placeholder">
        <span className="muted">Open a project to start editing.</span>
      </div>
    );
  }

  return (
    // key ensures TwickStudio fully remounts (with fresh providers) when project changes
    <LivePlayerProvider key={currentProject.id}>
      <TimelineProvider
        contextId={currentProject.id}
        initialData={initialData}
        analytics={{ enabled: false }}
      >
        <TwickBridge />
        <TwickStudio
          studioConfig={{
            videoProps: { width: 1920, height: 1080 },
            saveProject: handleSaveProject,
          }}
        />
      </TimelineProvider>
    </LivePlayerProvider>
  );
}
