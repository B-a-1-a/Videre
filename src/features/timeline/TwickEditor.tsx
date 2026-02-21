import { useCallback, useEffect, useMemo, useRef } from "react";
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
  const addElementRef = useRef(addElement);
  const editorRef = useRef(editor);

  useEffect(() => {
    addElementRef.current = addElement;
    editorRef.current = editor;
  }, [addElement, editor]);

  const addElementProxy = useCallback(async (element: unknown) => {
    await addElementRef.current(element as never);
  }, []);

  const getTimelineDataProxy = useCallback(() => {
    return editorRef.current.getTimelineData();
  }, []);

  useEffect(() => {
    setTwickAddElement(addElementProxy);
    setTwickGetTimelineData(getTimelineDataProxy);
    return () => {
      setTwickAddElement(null);
      setTwickGetTimelineData(null);
    };
  }, [addElementProxy, getTimelineDataProxy, setTwickAddElement, setTwickGetTimelineData]);

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

  if (!currentProject) return null;

  // key on LivePlayerProvider ensures full remount when project changes.
  // No extra wrapper div here; TwickStudio controls its own sizing.
  // .twick-wrapper on the parent layout handles clipping/overflow.
  return (
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
