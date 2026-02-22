import React, { useState, useRef, useCallback, useEffect } from "react";
import { DEFAULT_TRACK_HEIGHT, FPS, type ScrubberState } from "./types";
import { Trash2, Group, Ungroup, Archive } from "lucide-react";

// something something for the css not gonna bother with it for now
export interface SnapConfig {
  enabled: boolean;
  distance: number; // snap distance in pixels
}

export interface ScrubberProps {
  scrubber: ScrubberState;
  timelineWidth: number;
  otherScrubbers: ScrubberState[];
  onUpdate: (updatedScrubber: ScrubberState) => void;
  onDelete?: (scrubberId: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  expandTimeline: () => boolean;
  snapConfig: SnapConfig;
  trackCount: number;
  pixelsPerSecond: number;
  isSelected?: boolean;
  onSelect: (scrubberId: string, ctrlKey: boolean) => void;
  onGroupScrubbers: () => void;
  onUngroupScrubber: (scrubberId: string) => void;
  onMoveToMediaBin?: (scrubberId: string) => void;
  selectedScrubberIds: string[];
  onBeginTransform?: () => void; // drag or resize start snapshot
}

const SPEED_PRESETS = [1, 1.25, 1.5, 2];

export const Scrubber: React.FC<ScrubberProps> = ({
  scrubber,
  timelineWidth,
  otherScrubbers,
  onUpdate,
  onDelete,
  containerRef,
  expandTimeline,
  snapConfig,
  trackCount,
  pixelsPerSecond,
  isSelected = false,
  onSelect,
  onGroupScrubbers,
  onUngroupScrubber,
  onMoveToMediaBin,
  selectedScrubberIds = [],
  onBeginTransform,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeMode, setResizeMode] = useState<"left" | "right" | null>(null);
  const dragStateRef = useRef({
    offsetX: 0,
    startX: 0,
    startLeft: 0,
    startWidth: 0,
  });
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
  }>({ visible: false, x: 0, y: 0 });

  const MINIMUM_WIDTH = 20;
  const normalizePlaybackRate = useCallback((value: number | null | undefined) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return Math.min(4, Math.max(0.1, parsed));
  }, []);

  const getOriginalDurationFrames = useCallback(() => {
    if (!Number.isFinite(scrubber.durationInSeconds) || scrubber.durationInSeconds <= 0) {
      return null;
    }
    return Math.max(1, Math.round(scrubber.durationInSeconds * FPS));
  }, [scrubber.durationInSeconds]);

  const applyPlaybackRate = useCallback(
    (nextRateRaw: number) => {
      if (scrubber.mediaType !== "video" && scrubber.mediaType !== "audio") {
        return;
      }
      const originalDurationFrames = getOriginalDurationFrames();
      if (!originalDurationFrames) {
        return;
      }

      const trimBefore = Math.max(0, Math.round(scrubber.trimBefore || 0));
      const trimAfter = Math.max(0, Math.round(scrubber.trimAfter || 0));
      const maxSourceFrames = Math.max(1, originalDurationFrames - trimBefore);
      const sourceFrames = Math.max(
        1,
        Math.min(maxSourceFrames, originalDurationFrames - trimBefore - trimAfter)
      );
      const nextRate = normalizePlaybackRate(nextRateRaw);
      const maxTimelineWidth = Math.max(1, timelineWidth - scrubber.left);
      const requestedWidth = (sourceFrames / nextRate / FPS) * pixelsPerSecond;
      const boundedWidth = Math.max(1, Math.min(maxTimelineWidth, requestedWidth));

      const normalizedSourceFrames = Math.max(
        1,
        Math.min(
          maxSourceFrames,
          Math.round((boundedWidth / pixelsPerSecond) * FPS * nextRate)
        )
      );
      const normalizedTrimAfter = Math.max(
        0,
        originalDurationFrames - trimBefore - normalizedSourceFrames
      );
      const normalizedWidth =
        (normalizedSourceFrames / nextRate / FPS) * pixelsPerSecond;

      onUpdate({
        ...scrubber,
        playbackRate: nextRate,
        width: normalizedWidth,
        trimBefore,
        trimAfter: normalizedTrimAfter,
      });
    },
    [
      getOriginalDurationFrames,
      normalizePlaybackRate,
      onUpdate,
      pixelsPerSecond,
      scrubber,
      timelineWidth,
    ]
  );

  // Get snap points (scrubber edges and grid marks)
  const getSnapPoints = useCallback(
    (excludeId?: string) => {
      const snapPoints: number[] = [];

      // Add grid marks based on current zoom level
      for (let pos = 0; pos <= timelineWidth; pos += pixelsPerSecond) {
        snapPoints.push(pos);
      }

      // Add scrubber edges
      otherScrubbers.forEach((other) => {
        if (other.id !== excludeId) {
          snapPoints.push(other.left);
          snapPoints.push(other.left + other.width);
        }
      });

      return snapPoints;
    },
    [otherScrubbers, timelineWidth, pixelsPerSecond]
  );

  // Find nearest snap point
  const findSnapPoint = useCallback(
    (position: number, excludeId?: string): number => {
      if (!snapConfig.enabled) return position;

      const snapPoints = getSnapPoints(excludeId);

      for (const snapPos of snapPoints) {
        if (Math.abs(position - snapPos) < snapConfig.distance) {
          return snapPos;
        }
      }

      return position;
    },
    [snapConfig, getSnapPoints]
  );



  const handleMouseDown = useCallback(
    (e: React.MouseEvent, mode: "drag" | "resize-left" | "resize-right") => {
      e.preventDefault();
      e.stopPropagation();

      // Select the scrubber when clicked
      if (onSelect) {
        onSelect(scrubber.id, e.ctrlKey);
      }

      // Grouped clips cannot be resized directly.
      if (
        (mode === "resize-left" || mode === "resize-right") &&
        scrubber.mediaType === "groupped_scrubber"
      ) {
        return;
      }

      if (mode === "drag") {
        if (onBeginTransform) onBeginTransform();
        setIsDragging(true);
        dragStateRef.current.offsetX = e.clientX - scrubber.left;
      } else {
        if (onBeginTransform) onBeginTransform();
        setIsResizing(true);
        setResizeMode(mode === "resize-left" ? "left" : "right");
        dragStateRef.current.startX = e.clientX;
        dragStateRef.current.startLeft = scrubber.left;
        dragStateRef.current.startWidth = scrubber.width;
      }
    },
    [scrubber, onSelect, onBeginTransform]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging && !isResizing) return;
      // Remove throttling and requestAnimationFrame for responsive dragging
      if (isDragging) {
        let rawNewLeft = e.clientX - dragStateRef.current.offsetX;
        const min = 0;
        const max = timelineWidth - scrubber.width;
        rawNewLeft = Math.max(min, Math.min(max, rawNewLeft));

        // Calculate track changes based on mouse Y position with scroll offset
        let newTrack = scrubber.y || 0;
        if (containerRef.current) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const scrollTop = containerRef.current.scrollTop || 0;
          const mouseY = e.clientY - containerRect.top + scrollTop;
          const trackIndex = Math.floor(mouseY / DEFAULT_TRACK_HEIGHT);
          newTrack = Math.max(0, Math.min(trackCount - 1, trackIndex));
        }

        // Apply snapping to the position
        const snappedLeft = findSnapPoint(rawNewLeft, scrubber.id);
        const updatedScrubber = { ...scrubber, left: snappedLeft, y: newTrack };

        // Let the timeline handle collision detection and connected scrubber logic
        onUpdate(updatedScrubber);

        // Auto-scroll when dragging near edges
        if (containerRef.current) {
          const scrollSpeed = 10;
          const scrollThreshold = 100;
          const containerRect = containerRef.current.getBoundingClientRect();
          const mouseX = e.clientX;

          if (mouseX < containerRect.left + scrollThreshold) {
            containerRef.current.scrollLeft -= scrollSpeed;
          } else if (mouseX > containerRect.right - scrollThreshold) {
            containerRef.current.scrollLeft += scrollSpeed;
            expandTimeline();
          }
        }
      } else if (isResizing) {
        const deltaX = e.clientX - dragStateRef.current.startX;
        const isTimedMedia =
          scrubber.mediaType === "video" || scrubber.mediaType === "audio";
        const originalDurationFrames = isTimedMedia
          ? getOriginalDurationFrames()
          : null;
        const playbackRate = normalizePlaybackRate(scrubber.playbackRate);

        if (resizeMode === "left") {
          let newLeft = dragStateRef.current.startLeft + deltaX;
          let newWidth = dragStateRef.current.startWidth - deltaX;

          if (isTimedMedia && originalDurationFrames) {
            const startRight =
              dragStateRef.current.startLeft + dragStateRef.current.startWidth;
            const trimAfter = Math.max(0, Math.round(scrubber.trimAfter || 0));
            const maxSourceFrames = Math.max(1, originalDurationFrames - trimAfter);
            const maxWidthBySource =
              (maxSourceFrames / playbackRate / FPS) * pixelsPerSecond;
            const minWidth = Math.max(1, Math.min(MINIMUM_WIDTH, maxWidthBySource));

            newLeft = Math.max(0, newLeft);
            newLeft = findSnapPoint(newLeft, scrubber.id);
            newWidth = startRight - newLeft;
            newWidth = Math.max(minWidth, Math.min(newWidth, maxWidthBySource));

            let sourceFrames = Math.max(
              1,
              Math.min(
                maxSourceFrames,
                Math.round((newWidth / pixelsPerSecond) * FPS * playbackRate)
              )
            );
            let normalizedWidth =
              (sourceFrames / playbackRate / FPS) * pixelsPerSecond;
            let normalizedLeft = startRight - normalizedWidth;

            if (normalizedLeft < 0) {
              normalizedLeft = 0;
              sourceFrames = Math.max(
                1,
                Math.min(
                  maxSourceFrames,
                  Math.round(
                    (startRight / pixelsPerSecond) * FPS * playbackRate
                  )
                )
              );
              normalizedWidth =
                (sourceFrames / playbackRate / FPS) * pixelsPerSecond;
              normalizedLeft = Math.max(0, startRight - normalizedWidth);
            }

            const trimBefore = Math.max(
              0,
              originalDurationFrames - trimAfter - sourceFrames
            );
            const newScrubber = {
              ...scrubber,
              left: normalizedLeft,
              width: normalizedWidth,
              trimBefore,
              trimAfter,
            };
            onUpdate(newScrubber);
            return;
          }

          if (scrubber.width === MINIMUM_WIDTH && deltaX > 0) {
            return;
          }

          newLeft = Math.max(0, newLeft);
          newWidth = Math.max(MINIMUM_WIDTH, newWidth);
          newLeft = findSnapPoint(newLeft, scrubber.id);
          newWidth = dragStateRef.current.startLeft + dragStateRef.current.startWidth - newLeft;
          if (newLeft === 0) {
            newWidth = dragStateRef.current.startLeft + dragStateRef.current.startWidth;
          }
          if (newLeft + newWidth > timelineWidth) newWidth = timelineWidth - newLeft;

          const newScrubber = { ...scrubber, left: newLeft, width: newWidth };
          onUpdate(newScrubber);
        } else if (resizeMode === "right") {
          let newWidth = dragStateRef.current.startWidth + deltaX;

          if (isTimedMedia && originalDurationFrames) {
            const trimBefore = Math.max(0, Math.round(scrubber.trimBefore || 0));
            const maxSourceFrames = Math.max(1, originalDurationFrames - trimBefore);
            const maxWidthBySource =
              (maxSourceFrames / playbackRate / FPS) * pixelsPerSecond;
            const minWidth = Math.max(1, Math.min(MINIMUM_WIDTH, maxWidthBySource));

            newWidth = Math.max(minWidth, Math.min(maxWidthBySource, newWidth));
            let rightEdge = dragStateRef.current.startLeft + newWidth;
            rightEdge = findSnapPoint(rightEdge, scrubber.id);
            newWidth = rightEdge - dragStateRef.current.startLeft;
            newWidth = Math.max(minWidth, Math.min(maxWidthBySource, newWidth));

            if (dragStateRef.current.startLeft + newWidth > timelineWidth) {
              if (expandTimeline()) {
                const expandedRightEdge = findSnapPoint(
                  dragStateRef.current.startLeft +
                    dragStateRef.current.startWidth +
                    deltaX,
                  scrubber.id
                );
                newWidth = expandedRightEdge - dragStateRef.current.startLeft;
                newWidth = Math.max(minWidth, Math.min(maxWidthBySource, newWidth));
              } else {
                newWidth = timelineWidth - dragStateRef.current.startLeft;
              }
            }

            let sourceFrames = Math.max(
              1,
              Math.min(
                maxSourceFrames,
                Math.round((newWidth / pixelsPerSecond) * FPS * playbackRate)
              )
            );
            const maxWidthByTimeline = Math.max(
              1,
              timelineWidth - dragStateRef.current.startLeft
            );
            let normalizedWidth =
              (sourceFrames / playbackRate / FPS) * pixelsPerSecond;
            if (normalizedWidth > maxWidthByTimeline) {
              sourceFrames = Math.max(
                1,
                Math.min(
                  maxSourceFrames,
                  Math.round(
                    (maxWidthByTimeline / pixelsPerSecond) * FPS * playbackRate
                  )
                )
              );
              normalizedWidth =
                (sourceFrames / playbackRate / FPS) * pixelsPerSecond;
            }
            const trimAfter = Math.max(
              0,
              originalDurationFrames - trimBefore - sourceFrames
            );

            const newScrubber = {
              ...scrubber,
              width: normalizedWidth,
              trimBefore,
              trimAfter,
            };
            onUpdate(newScrubber);
            return;
          }

          newWidth = Math.max(MINIMUM_WIDTH, newWidth);
          const rightEdge = dragStateRef.current.startLeft + newWidth;
          const snappedRightEdge = findSnapPoint(rightEdge, scrubber.id);
          newWidth = snappedRightEdge - dragStateRef.current.startLeft;

          if (dragStateRef.current.startLeft + newWidth > timelineWidth) {
            if (expandTimeline()) {
              const expandedRightEdge = findSnapPoint(
                dragStateRef.current.startLeft +
                  dragStateRef.current.startWidth +
                  deltaX,
                scrubber.id
              );
              newWidth = expandedRightEdge - dragStateRef.current.startLeft;
            } else {
              newWidth = timelineWidth - dragStateRef.current.startLeft;
            }
          }

          onUpdate({ ...scrubber, width: newWidth });
        }
      }
    },
    [
      isDragging,
      isResizing,
      resizeMode,
      scrubber,
      timelineWidth,
      getOriginalDurationFrames,
      normalizePlaybackRate,
      onUpdate,
      expandTimeline,
      containerRef,
      findSnapPoint,
      trackCount,
      pixelsPerSecond,
    ]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
    setResizeMode(null);
  }, []);

  useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Handle deletion with Delete/Backspace keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSelected && (e.key === "Delete" || e.key === "Backspace")) {
        // Prevent default behavior and check if we're not in an input field
        const target = e.target as HTMLElement;
        const isInputElement =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.contentEditable === "true" ||
          target.isContentEditable;

        if (!isInputElement && onDelete) {
          e.preventDefault();
          onDelete(scrubber.id);
        }
      }
    };

    if (isSelected) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isSelected, onDelete, scrubber.id]);

  // Professional scrubber colors based on media type
  const getScrubberColor = () => {
    const baseColors = {
      video: "bg-primary border-primary/60 text-primary-foreground",
      image: "bg-green-600 border-green-500 text-white",
      text: "bg-purple-600 border-purple-500 text-white",
      default: "bg-primary border-primary/60 text-primary-foreground",
      audio: "bg-blue-600 border-blue-400 text-white",
      groupped_scrubber: "bg-gray-600 border-gray-400 text-white",
    };

    const selectedColors = {
      video:
        "bg-primary border-primary text-primary-foreground ring-2 ring-primary/50",
      image:
        "bg-green-600 border-green-400 text-white ring-2 ring-green-400/50",
      text: "bg-purple-600 border-purple-400 text-white ring-2 ring-purple-400/50",
      audio:
        "bg-blue-600 border-blue-400 text-white ring-2 ring-blue-400/50",
      default:
        "bg-primary border-primary text-primary-foreground ring-2 ring-primary/50",
      groupped_scrubber:
        "bg-gray-600 border-gray-400 text-white ring-2 ring-gray-400/50",
    };

    const colorSet = isSelected ? selectedColors : baseColors;
    return colorSet[scrubber.mediaType] || colorSet.default;
  };

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Select the scrubber when right-clicked
    if (onSelect) {
      onSelect(scrubber.id, e.ctrlKey);
    }

    // Get the position relative to the viewport
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
    });
  }, [onSelect, scrubber.id]);

  // Close context menu when clicking outside
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (contextMenu.visible) {
      setContextMenu({ visible: false, x: 0, y: 0 });
    }
  }, [contextMenu.visible]);

  // Handle context menu delete action
  const handleContextMenuDelete = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (onDelete) {
      onDelete(scrubber.id);
    }

    // Close context menu
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [onDelete, scrubber.id]);

  // Handle context menu group action
  const handleContextMenuGroup = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (onGroupScrubbers) {
      onGroupScrubbers();
    }

    // Close context menu
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [onGroupScrubbers]);

  // Handle context menu ungroup action
  const handleContextMenuUngroup = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (onUngroupScrubber) {
      onUngroupScrubber(scrubber.id);
    }

    // Close context menu
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [onUngroupScrubber, scrubber.id]);

  // Handle context menu move to media bin action
  const handleContextMenuMoveToMediaBin = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (onMoveToMediaBin) {
      onMoveToMediaBin(scrubber.id);
    }

    // Close context menu
    setContextMenu({ visible: false, x: 0, y: 0 });
  }, [onMoveToMediaBin, scrubber.id]);

  const handleContextMenuSetSpeed = useCallback(
    (e: React.MouseEvent, speed: number) => {
      e.preventDefault();
      e.stopPropagation();

      if (onBeginTransform) onBeginTransform();
      applyPlaybackRate(speed);
      setContextMenu({ visible: false, x: 0, y: 0 });
    },
    [applyPlaybackRate, onBeginTransform]
  );

  // Add click outside listener for context menu
  useEffect(() => {
    if (contextMenu.visible) {
      document.addEventListener("click", handleClickOutside);
      document.addEventListener("contextmenu", handleClickOutside);

      return () => {
        document.removeEventListener("click", handleClickOutside);
        document.removeEventListener("contextmenu", handleClickOutside);
      };
    }
  }, [contextMenu.visible, handleClickOutside]);

  return (
    <>
      <div
        className={`group absolute rounded-sm cursor-grab active:cursor-grabbing border shadow-sm hover:shadow-md transition-all ${getScrubberColor()} select-none`}
        style={{
          left: `${scrubber.left}px`,
          width: `${scrubber.width}px`,
          top: `${(scrubber.y || 0) * DEFAULT_TRACK_HEIGHT + 2}px`,
          height: `${DEFAULT_TRACK_HEIGHT - 4}px`,
          minWidth: "20px",
          zIndex: isDragging || isResizing ? 1000 : isSelected ? 20 : 15,
        }}
        onMouseDown={(e) => handleMouseDown(e, "drag")}
        onContextMenu={handleContextMenu}
      >
        {/* Media type indicator - positioned after left resize handle */}
        <div className="absolute top-0.5 left-3 text-xs font-medium opacity-80 pointer-events-none">
          {scrubber.mediaType === "video" && "V"}
          {scrubber.mediaType === "image" && "I"}
          {scrubber.mediaType === "text" && "T"}
          {scrubber.mediaType === "audio" && "A"}
          {scrubber.mediaType === "groupped_scrubber" && "G"}
        </div>

        {/* Media name */}
        <div className="absolute top-0.5 left-6 right-6 text-xs truncate opacity-90 pointer-events-none">
          {scrubber.name}
          {(scrubber.mediaType === "video" || scrubber.mediaType === "audio") &&
          Math.abs(normalizePlaybackRate(scrubber.playbackRate) - 1) > 0.01
            ? ` (${normalizePlaybackRate(scrubber.playbackRate).toFixed(2)}x)`
            : ""}
        </div>

        {/* Left resize handle - more visible */}
        {scrubber.mediaType !== "groupped_scrubber" && (
          <div
            className="absolute top-0 left-0 h-full w-2 cursor-ew-resize z-20 hover:bg-white/30 transition-colors border-r border-white/20 group-hover:bg-white/10"
            onMouseDown={(e) => handleMouseDown(e, "resize-left")}
            title={
              scrubber.mediaType === "video" || scrubber.mediaType === "audio"
                ? "Trim left edge"
                : "Resize left edge"
            }
          />
        )}

        {/* Right resize handle - more visible */}
        {scrubber.mediaType !== "groupped_scrubber" && (
          <div
            className="absolute top-0 right-0 h-full w-2 cursor-ew-resize z-20 hover:bg-white/30 transition-colors border-l border-white/20 group-hover:bg-white/10"
            onMouseDown={(e) => handleMouseDown(e, "resize-right")}
            title={
              scrubber.mediaType === "video" || scrubber.mediaType === "audio"
                ? "Trim right edge"
                : "Resize right edge"
            }
          />
        )}

        {/* Selection indicator - theme-appropriate glow effect */}
        {isSelected && (
          <div className="absolute -inset-0.5 rounded-sm pointer-events-none shadow-md shadow-primary/30 ring-1 ring-primary/60" />
        )}

        {/* Name and position tooltip when dragging - positioned above or below based on track */}
        {isDragging && (
          <div
            className={`absolute left-1/2 transform -translate-x-1/2 bg-popover text-popover-foreground text-xs px-2 py-1 rounded-sm pointer-events-none border border-border shadow-md z-50 whitespace-nowrap ${(scrubber.y || 0) === 0 ? "top-full mt-1" : "-top-8"
              }`}
          >
            {scrubber.name} • {(scrubber.left / pixelsPerSecond).toFixed(2)}s -{" "}
            {((scrubber.left + scrubber.width) / pixelsPerSecond).toFixed(2)}s
          </div>
        )}

        {/* Resize tooltips when resizing - showing precise timestamps with dynamic positioning */}
        {isResizing && (
          <div
            className={`absolute left-1/2 transform -translate-x-1/2 bg-popover text-popover-foreground text-xs px-2 py-1 rounded-sm pointer-events-none border border-border shadow-md z-50 whitespace-nowrap ${(scrubber.y || 0) === 0 ? "top-full mt-1" : "-top-8"
              }`}
          >
            {resizeMode === "left"
              ? `Start: ${(scrubber.left / pixelsPerSecond).toFixed(2)}s`
              : `End: ${(
                (scrubber.left + scrubber.width) /
                pixelsPerSecond
              ).toFixed(2)}s`}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          className="fixed bg-popover text-popover-foreground border border-border rounded-md shadow-lg py-1 z-[9999]"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
        >
          {/* Show Group option if multiple scrubbers are selected but this isn't grouped */}
          {selectedScrubberIds.length > 1 && scrubber.mediaType !== "groupped_scrubber" && (
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors text-left"
              onClick={handleContextMenuGroup}
            >
              <Group className="h-3 w-3" />
              Group Selected
            </button>
          )}

          {/* Show Ungroup option if this is a grouped scrubber */}
          {scrubber.mediaType === "groupped_scrubber" && (
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors text-left"
              onClick={handleContextMenuUngroup}
            >
              <Ungroup className="h-3 w-3" />
              Ungroup
            </button>
          )}

          {/* Show Move to Media Bin option only for grouped scrubbers */}
          {scrubber.mediaType === "groupped_scrubber" && (
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors text-left"
              onClick={handleContextMenuMoveToMediaBin}
            >
              <Archive className="h-3 w-3" />
              Move to Media Bin
            </button>
          )}

          {(scrubber.mediaType === "video" || scrubber.mediaType === "audio") && (
            <>
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Playback speed
              </div>
              {SPEED_PRESETS.map((speed) => {
                const normalizedSpeed = normalizePlaybackRate(scrubber.playbackRate);
                const isCurrent = Math.abs(normalizedSpeed - speed) < 0.01;
                return (
                  <button
                    key={`speed-${speed}`}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors text-left hover:bg-muted ${isCurrent ? "font-semibold text-foreground" : "text-muted-foreground"
                      }`}
                    onClick={(e) => handleContextMenuSetSpeed(e, speed)}
                  >
                    {isCurrent ? "✓ " : ""}
                    {speed.toFixed(speed % 1 === 0 ? 0 : 2)}x
                  </button>
                );
              })}
            </>
          )}

          <button
            className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-muted transition-colors text-left text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            onClick={handleContextMenuDelete}
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>
      )}
    </>
  );
};
