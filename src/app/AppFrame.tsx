import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Toaster } from "sonner";
import {
  onImportDone,
  onImportFailed,
  onImportProgress,
  onRenderDone,
  onRenderFailed,
  onRenderProgress,
} from "../lib/ipc";
import { useEditorStore } from "../store/editorStore";

export function AppFrame() {
  const openProject = useEditorStore((s) => s.openProject);
  const updateImportProgress = useEditorStore((s) => s.updateImportProgress);
  const pollRenderStatus = useEditorStore((s) => s.pollRenderStatus);

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
      const project = useEditorStore.getState().currentProject;
      if (project?.id === event.projectId) {
        void openProject(project.rootPath);
      }
    }).then((dispose) => {
      unlistenDone = dispose;
    });

    void onImportFailed((event) => {
      updateImportProgress(event.assetId, 1);
    }).then((dispose) => {
      unlistenFailed = dispose;
    });

    void onRenderProgress(() => void pollRenderStatus()).then((dispose) => {
      unlistenRenderProgress = dispose;
    });
    void onRenderDone(() => void pollRenderStatus()).then((dispose) => {
      unlistenRenderDone = dispose;
    });
    void onRenderFailed(() => void pollRenderStatus()).then((dispose) => {
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
    <>
      <Outlet />
      <Toaster position="top-right" richColors />
    </>
  );
}
