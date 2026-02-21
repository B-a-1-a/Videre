import { useEffect } from "react";
import { useEditorStore } from "../../store/editorStore";
import { MIN_ZOOM_PX_PER_SEC, MAX_ZOOM_PX_PER_SEC, PLAYHEAD_ADVANCE_MS } from "./constants";
import { clamp } from "./utils";

export function useKeyboardShortcuts() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const state = useEditorStore.getState();
      const isMeta = e.metaKey || e.ctrlKey;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          state.togglePlayback();
          break;

        case "Delete":
        case "Backspace":
          if (state.selectedClipId) {
            e.preventDefault();
            void state.deleteSelectedClip();
          }
          break;

        case "KeyS":
          if (isMeta) {
            e.preventDefault();
            void state.saveProject();
          } else {
            e.preventDefault();
            void state.splitAtPlayhead();
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          state.setPlayheadMs(Math.max(0, state.playheadMs - PLAYHEAD_ADVANCE_MS));
          break;

        case "ArrowRight":
          e.preventDefault();
          state.setPlayheadMs(state.playheadMs + PLAYHEAD_ADVANCE_MS);
          break;

        case "Equal":
        case "NumpadAdd":
          e.preventDefault();
          state.setZoomPxPerSec(clamp(state.zoomPxPerSec + 20, MIN_ZOOM_PX_PER_SEC, MAX_ZOOM_PX_PER_SEC));
          break;

        case "Minus":
        case "NumpadSubtract":
          e.preventDefault();
          state.setZoomPxPerSec(clamp(state.zoomPxPerSec - 20, MIN_ZOOM_PX_PER_SEC, MAX_ZOOM_PX_PER_SEC));
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
}
