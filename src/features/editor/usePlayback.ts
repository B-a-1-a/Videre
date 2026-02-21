import { useEffect, useRef } from "react";
import { useEditorStore } from "../../store/editorStore";

export function usePlayback() {
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    const tick = (now: number) => {
      const { isPlaying, playheadMs, timeline, setPlayheadMs, togglePlayback } =
        useEditorStore.getState();

      if (!isPlaying) {
        lastTimeRef.current = 0;
        return;
      }

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = now;
      }

      const deltaMs = now - lastTimeRef.current;
      lastTimeRef.current = now;

      const newMs = playheadMs + deltaMs;
      const endMs = timeline?.durationMs ?? 0;

      if (endMs > 0 && newMs >= endMs) {
        setPlayheadMs(endMs);
        togglePlayback(); // auto-pause at end
        return;
      }

      setPlayheadMs(newMs);
      rafRef.current = requestAnimationFrame(tick);
    };

    const unsubscribe = useEditorStore.subscribe((state) => {
      const isPlaying = state.isPlaying;
      if (isPlaying && !wasPlayingRef.current) {
        wasPlayingRef.current = true;
        lastTimeRef.current = 0;
        rafRef.current = requestAnimationFrame(tick);
      } else if (!isPlaying && wasPlayingRef.current) {
        wasPlayingRef.current = false;
        cancelAnimationFrame(rafRef.current);
        lastTimeRef.current = 0;
      }
    });

    // Start if already playing
    if (useEditorStore.getState().isPlaying) {
      wasPlayingRef.current = true;
      lastTimeRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      unsubscribe();
      cancelAnimationFrame(rafRef.current);
    };
  }, []);
}
