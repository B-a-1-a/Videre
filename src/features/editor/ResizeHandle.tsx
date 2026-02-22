import { useCallback, useEffect, useRef, useState } from "react";

interface ResizeHandleProps {
  direction: "horizontal" | "vertical";
  onResize: (delta: number) => void;
}

export function ResizeHandle({ direction, onResize }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const lastPos = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      lastPos.current = direction === "horizontal" ? e.clientX : e.clientY;
      setDragging(true);
    },
    [direction],
  );

  useEffect(() => {
    if (!dragging) return;

    function handleMouseMove(e: MouseEvent) {
      const current = direction === "horizontal" ? e.clientX : e.clientY;
      const delta = current - lastPos.current;
      lastPos.current = current;
      if (delta !== 0) onResize(delta);
    }

    function handleMouseUp() {
      setDragging(false);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, direction, onResize]);

  const className = `resize-handle resize-handle-${direction}${dragging ? " dragging" : ""}`;

  return <div className={className} onMouseDown={handleMouseDown} />;
}
