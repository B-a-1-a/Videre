import React, { useRef, useEffect, useCallback, useState } from "react";
import type { PlayerRef, CallbackListener } from "@remotion/player";
import {
  Play,
  Pause,
  Upload,
  Download,
  Settings,
  Plus,
  Minus,
  Scissors,
  Save as SaveIcon,
  CornerUpLeft,
  CornerUpRight,
  ArrowLeft,
  Sun,
  Moon,
} from "lucide-react";

// Custom video controls
import { MuteButton, FullscreenButton } from "~/components/ui/video-controls";

// Components
import LeftPanel from "~/components/editor/LeftPanel";
import { VideoPlayer } from "~/video-compositions/VideoPlayer";
import { RenderStatus } from "~/components/timeline/RenderStatus";
import { TimelineRuler } from "~/components/timeline/TimelineRuler";
import { TimelineTracks } from "~/components/timeline/TimelineTracks";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Separator } from "~/components/ui/separator";
import { Switch } from "~/components/ui/switch";
import { Label } from "~/components/ui/label";
import { Input } from "~/components/ui/input";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "~/components/ui/resizable";
import { toast } from "sonner";

// Hooks
import { useTimeline } from "~/hooks/useTimeline";
import { useMediaBin } from "~/hooks/useMediaBin";
import { useRuler } from "~/hooks/useRuler";
import { useRenderer } from "~/hooks/useRenderer";

// Types and constants
import {
  FPS,
  type MediaBinItem,
  type TimelineState,
  type Transition,
} from "~/components/timeline/types";
import { useNavigate, useParams } from "react-router";
import { ChatBox } from "~/components/chat/ChatBox";
import { VidereLogo } from "~/components/ui/VidereLogo";
import { useAuth } from "~/hooks/useAuth";
import { useTheme } from "next-themes";
import type {
  ApplyTranscriptEditRequest,
  ApplyTranscriptEditResult,
  ClipTranscriptsMap,
  GenerateClipCaptionsRequest,
  GenerateClipCaptionsResult,
} from "~/components/media/captions.types";
import {
  buildTranscribeJobFromScrubber,
  normalizeClipTranscriptRecord,
  requestClipTranscription,
} from "~/lib/clip-transcription";
import {
  normalizeMediaBinItems,
  reconcileTimelineWithMediaBin,
  sanitizeMediaBinItemsForPersistence,
  sanitizeTimelineForPersistence,
} from "~/lib/media-persistence";

interface Message {
  id: string;
  content: string;
  isUser: boolean;
  timestamp: Date;
}

const EMPTY_TIMELINE: TimelineState = {
  tracks: [
    { id: "track-1", scrubbers: [], transitions: [] },
    { id: "track-2", scrubbers: [], transitions: [] },
    { id: "track-3", scrubbers: [], transitions: [] },
    { id: "track-4", scrubbers: [], transitions: [] },
  ],
};

function findScrubberById(
  timeline: TimelineState,
  scrubberId: string
) {
  for (const track of timeline.tracks) {
    const scrubber = track.scrubbers.find((item) => item.id === scrubberId);
    if (scrubber) return scrubber;
  }
  return null;
}

export default function TimelineEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PlayerRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { theme, setTheme } = useTheme();

  const navigate = useNavigate();
  const params = useParams();
  const projectId = params?.id as string | undefined;
  const [projectName, setProjectName] = useState<string>("");

  const [width, setWidth] = useState<number>(1920);
  const [height, setHeight] = useState<number>(1080);
  const [isAutoSize, setIsAutoSize] = useState<boolean>(false);
  // Text fields for width/height to allow clearing while typing
  const [widthInput, setWidthInput] = useState<string>("1920");
  const [heightInput, setHeightInput] = useState<string>("1080");
  const widthInputRef = useRef<HTMLInputElement>(null);
  const heightInputRef = useRef<HTMLInputElement>(null);

  // Keep inputs in sync if width/height change elsewhere
  useEffect(() => {
    setWidthInput(String(width));
  }, [width]);
  useEffect(() => {
    setHeightInput(String(height));
  }, [height]);

  const [isChatMinimized, setIsChatMinimized] = useState<boolean>(false);

  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  // Avoid initial blank render; don't delay render on a 'mounted' gate

  const [selectedScrubberIds, setSelectedScrubberIds] = useState<string[]>([]);
  const [clipTranscripts, setClipTranscripts] = useState<ClipTranscriptsMap>({});

  // video player media selection state
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const {
    timeline,
    timelineWidth,
    zoomLevel,
    getPixelsPerSecond,
    getTimelineData,
    getTimelineState,
    expandTimeline,
    handleAddTrack,
    handleDeleteTrack,
    getAllScrubbers,
    handleUpdateScrubber,
    handleDeleteScrubber,
    handleDeleteScrubbersByMediaBinId,
    handleDropOnTrack,
    handleSplitScrubberAtRuler,
    handleCutScrubberWithSegments,
    handleGenerateCaptionsFromTranscript,
    handleZoomIn,
    handleZoomOut,
    handleZoomReset,
    handleGroupScrubbers,
    handleUngroupScrubber,
    handleMoveGroupToMediaBin,
    // Transition management
    handleAddTransitionToTrack,
    handleDeleteTransition,
    getConnectedElements,
    handleUpdateScrubberWithLocking,
    setTimelineFromServer,
    getTimelineViewState,
    setTimelineViewState,
    // undo/redo
    undo,
    redo,
    canUndo,
    canRedo,
    snapshotTimeline,
  } = useTimeline();

  const {
    mediaBinItems,
    isMediaLoading,
    getMediaBinItems,
    setMediaItems,
    handleAddMediaToBin,
    handleAddTextToBin,
    handleAddGroupToMediaBin,
    contextMenu,
    handleContextMenu,
    handleDeleteFromContext,
    handleSplitAudioFromContext,
    handleCloseContextMenu,
  } = useMediaBin(handleDeleteScrubbersByMediaBinId);

  const {
    rulerPositionPx,
    isDraggingRuler,
    handleRulerDrag,
    handleRulerMouseDown,
    handleRulerMouseMove,
    handleRulerMouseUp,
    handleScroll,
    updateRulerFromPlayer,
  } = useRuler(playerRef, timelineWidth, getPixelsPerSecond());

  const { isRendering, renderStatus, handleRenderVideo } = useRenderer();
  const timelineRef = useRef(timeline);
  const autoTranscribeQueueRef = useRef<string[]>([]);
  const autoTranscribeMissingRetryRef = useRef<Record<string, number>>({});
  const isAutoTranscribingRef = useRef(false);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  // Wrapper function for transition drop handler to match expected interface
  const handleDropTransitionOnTrackWrapper = (transition: Transition, trackId: string, dropLeftPx: number) => {
    handleAddTransitionToTrack(trackId, transition, dropLeftPx);
  };

  const processAutoTranscribeQueue = useCallback(async () => {
    if (isAutoTranscribingRef.current) return;
    isAutoTranscribingRef.current = true;

    try {
      while (autoTranscribeQueueRef.current.length > 0) {
        const scrubberId = autoTranscribeQueueRef.current.shift();
        if (!scrubberId) continue;

        const scrubber = findScrubberById(timelineRef.current, scrubberId);
        if (!scrubber) {
          const retryCount =
            autoTranscribeMissingRetryRef.current[scrubberId] || 0;
          if (retryCount < 5) {
            autoTranscribeMissingRetryRef.current[scrubberId] = retryCount + 1;
            autoTranscribeQueueRef.current.push(scrubberId);
            await new Promise((resolve) => window.setTimeout(resolve, 120));
            continue;
          }
          delete autoTranscribeMissingRetryRef.current[scrubberId];
          setClipTranscripts((prev) => ({
            ...prev,
            [scrubberId]: normalizeClipTranscriptRecord({
              scrubberId,
              scrubber: null,
              error: "Clip was not found in the timeline.",
            }),
          }));
          continue;
        }

        delete autoTranscribeMissingRetryRef.current[scrubberId];

        const jobOrError = buildTranscribeJobFromScrubber(scrubber);
        if ("error" in jobOrError) {
          setClipTranscripts((prev) => ({
            ...prev,
            [scrubberId]: normalizeClipTranscriptRecord({
              scrubberId,
              scrubber,
              error: jobOrError.error,
            }),
          }));
          continue;
        }

        try {
          const payload = await requestClipTranscription({
            projectId,
            jobs: [jobOrError],
          });
          const result = payload.results.find(
            (item) => item.scrubberId === scrubberId
          );

          setClipTranscripts((prev) => ({
            ...prev,
            [scrubberId]: normalizeClipTranscriptRecord({
              scrubberId,
              scrubber,
              result: result || null,
              error: result ? null : "No transcription result returned.",
            }),
          }));
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to transcribe selected clip.";

          setClipTranscripts((prev) => ({
            ...prev,
            [scrubberId]: normalizeClipTranscriptRecord({
              scrubberId,
              scrubber,
              error: message,
            }),
          }));
        }
      }
    } finally {
      isAutoTranscribingRef.current = false;
      if (autoTranscribeQueueRef.current.length > 0) {
        window.setTimeout(() => {
          void processAutoTranscribeQueue();
        }, 0);
      }
    }
  }, [projectId]);

  const enqueueAutoTranscribe = useCallback(
    (scrubberId: string) => {
      if (!scrubberId) return;
      if (!autoTranscribeQueueRef.current.includes(scrubberId)) {
        autoTranscribeQueueRef.current.push(scrubberId);
      }
      window.setTimeout(() => {
        void processAutoTranscribeQueue();
      }, 0);
    },
    [processAutoTranscribeQueue]
  );

  const handleDropOnTrackWithAutoTranscribe = useCallback(
    (item: MediaBinItem, trackId: string, dropLeftPx: number) => {
      const created = handleDropOnTrack(item, trackId, dropLeftPx);
      if (created?.scrubberId) {
        enqueueAutoTranscribe(created.scrubberId);
      }
      return created;
    },
    [enqueueAutoTranscribe, handleDropOnTrack]
  );

  // Derived values
  const timelineData = getTimelineData();
  const durationInFrames = (() => {
    let maxEndTime = 0;

    // Calculate the maximum end time from all scrubbers
    // Since overlapping scrubbers are already positioned correctly,
    // we just need the maximum end time
    timelineData.forEach((timelineItem) => {
      timelineItem.scrubbers.forEach((scrubber) => {
        if (scrubber.endTime > maxEndTime) maxEndTime = scrubber.endTime;
      });
    });

    return Math.ceil(maxEndTime * FPS);
  })();

  // Event handlers with toast notifications
  const handleAddMediaClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const [hasHydratedProject, setHasHydratedProject] = useState(false);
  const lastPersistedSignatureRef = useRef<string>("");
  const isPersistingRef = useRef(false);

  const resolveProjectId = useCallback(() => {
    return (
      projectId ||
      window.location.pathname.match(/\/project\/([^/]+)/)?.[1] ||
      ""
    );
  }, [projectId]);

  type PersistPayload = {
    timeline: TimelineState;
    mediaBinItems: MediaBinItem[];
    clipTranscripts: ClipTranscriptsMap;
    editorState: { zoomLevel: number; timelineWidth: number };
  };

  const buildPersistPayload = useCallback((): PersistPayload => {
    const mediaPayload = sanitizeMediaBinItemsForPersistence(getMediaBinItems());
    const timelinePayload = sanitizeTimelineForPersistence(
      getTimelineState(),
      mediaPayload
    );
    const editorState = getTimelineViewState();
    return {
      timeline: timelinePayload,
      mediaBinItems: mediaPayload,
      clipTranscripts,
      editorState,
    };
  }, [
    clipTranscripts,
    getMediaBinItems,
    getTimelineState,
    getTimelineViewState,
  ]);

  const persistProjectState = useCallback(
    async ({
      silent = false,
      keepalive = false,
    }: { silent?: boolean; keepalive?: boolean } = {}) => {
      const id = resolveProjectId();
      if (!id) {
        if (!silent) toast.error("No project ID");
        return false;
      }

      const payload = buildPersistPayload();
      const signature = JSON.stringify(payload);
      if (signature === lastPersistedSignatureRef.current) {
        if (!silent) {
          toast.success("Timeline already saved");
        }
        return true;
      }

      if (isPersistingRef.current) {
        return false;
      }
      isPersistingRef.current = true;

      try {
        if (!silent) {
          toast.info("Saving state of the project...");
        }
        const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive,
        });
        if (!res.ok) {
          throw new Error(await res.text());
        }
        lastPersistedSignatureRef.current = signature;
        if (!silent) {
          toast.success("Timeline saved");
        }
        return true;
      } catch (error) {
        console.error(error);
        if (!silent) {
          toast.error("Failed to save");
        }
        return false;
      } finally {
        isPersistingRef.current = false;
      }
    },
    [buildPersistPayload, resolveProjectId]
  );

  // Hydrate project state.
  useEffect(() => {
    let cancelled = false;
    setHasHydratedProject(false);

    (async () => {
      const id = resolveProjectId();
      if (!id) return;

      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
      if (!res.ok) {
        if (!cancelled) navigate("/projects");
        return;
      }

      const payload = (await res.json()) as {
        project?: { name?: string };
        timeline?: TimelineState;
        mediaBinItems?: MediaBinItem[];
        textBinItems?: MediaBinItem[];
        clipTranscripts?: ClipTranscriptsMap;
        editorState?: { zoomLevel?: number; timelineWidth?: number };
      };

      if (cancelled) return;

      setProjectName(payload.project?.name || "Project");
      const hydratedMediaBinItems = normalizeMediaBinItems(
        Array.isArray(payload.mediaBinItems)
          ? payload.mediaBinItems
          : Array.isArray(payload.textBinItems)
            ? payload.textBinItems
            : []
      );
      setMediaItems(hydratedMediaBinItems);

      const hydratedTimeline = reconcileTimelineWithMediaBin(
        payload.timeline ?? EMPTY_TIMELINE,
        hydratedMediaBinItems
      );
      setTimelineFromServer(hydratedTimeline);

      const hydratedClipTranscripts =
        payload.clipTranscripts &&
          typeof payload.clipTranscripts === "object" &&
          !Array.isArray(payload.clipTranscripts)
          ? payload.clipTranscripts
          : {};
      setClipTranscripts(hydratedClipTranscripts);

      const viewState = {
        zoomLevel:
          Number.isFinite(Number(payload.editorState?.zoomLevel)) &&
            Number(payload.editorState?.zoomLevel) > 0
            ? Number(payload.editorState?.zoomLevel)
            : 1,
        timelineWidth:
          Number.isFinite(Number(payload.editorState?.timelineWidth)) &&
            Number(payload.editorState?.timelineWidth) > 0
            ? Math.round(Number(payload.editorState?.timelineWidth))
            : 2000,
      };
      setTimelineViewState(viewState);

      const hydratedPayload: PersistPayload = {
        timeline: sanitizeTimelineForPersistence(
          hydratedTimeline,
          hydratedMediaBinItems
        ),
        mediaBinItems: sanitizeMediaBinItemsForPersistence(hydratedMediaBinItems),
        clipTranscripts: hydratedClipTranscripts,
        editorState: viewState,
      };
      lastPersistedSignatureRef.current = JSON.stringify(hydratedPayload);
      setHasHydratedProject(true);
    })().catch((error) => {
      console.error("Failed to load project", error);
      if (!cancelled) navigate("/projects");
    });

    return () => {
      cancelled = true;
    };
  }, [
    navigate,
    projectId,
    resolveProjectId,
    setMediaItems,
    setTimelineFromServer,
    setTimelineViewState,
  ]);

  // Debounced autosave after hydration.
  useEffect(() => {
    if (!hasHydratedProject) return;
    const timeout = window.setTimeout(() => {
      void persistProjectState({ silent: true });
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [
    clipTranscripts,
    hasHydratedProject,
    mediaBinItems,
    persistProjectState,
    timeline,
    timelineWidth,
    zoomLevel,
  ]);

  // Best-effort save on window close/navigation.
  useEffect(() => {
    if (!hasHydratedProject) return;
    const flush = () => {
      void persistProjectState({ silent: true, keepalive: true });
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [hasHydratedProject, persistProjectState]);

  const handleSaveTimeline = useCallback(async () => {
    await persistProjectState({ silent: false });
  }, [persistProjectState]);

  // Global Ctrl/Cmd+S to save timeline (registered after handler is defined)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isInputEl =
        ((e.target as HTMLElement)?.tagName || "").match(/^(INPUT|TEXTAREA)$/) ||
        (e.target as HTMLElement)?.isContentEditable;
      if (isInputEl) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "s") {
        e.preventDefault();
        e.stopPropagation();
        handleSaveTimeline();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "z" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "z" && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        redo();
        return;
      }
      // Delete selected item from Player (not just timeline scrubber)
      if (key === "delete") {
        if (selectedItem) {
          e.preventDefault();
          e.stopPropagation();
          handleDeleteScrubber(selectedItem);
          setSelectedItem(null);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, {
      capture: true,
    } as AddEventListenerOptions);
    return () =>
      window.removeEventListener("keydown", onKeyDown, {
        capture: true,
      } as AddEventListenerOptions);
  }, [handleSaveTimeline, undo, redo, selectedItem, handleDeleteScrubber, setSelectedItem]);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        const fileArray = Array.from(files);
        let successCount = 0;
        let errorCount = 0;

        // Process files sequentially to avoid overwhelming the system
        for (const file of fileArray) {
          try {
            await handleAddMediaToBin(file);
            successCount++;
          } catch (error) {
            errorCount++;
            console.error(`Failed to add ${file.name}:`, error);
          }
        }

        if (successCount > 0 && errorCount > 0) {
          toast.warning(`Imported ${successCount} file${successCount > 1 ? "s" : ""}, ${errorCount} failed`);
        } else if (errorCount > 0) {
          toast.error(`Failed to import ${errorCount} file${errorCount > 1 ? "s" : ""}`);
        }

        e.target.value = "";
      }
    },
    [handleAddMediaToBin],
  );

  const handleRenderClick = useCallback(() => {
    if (timelineData.length === 0 || timelineData.every((item) => item.scrubbers.length === 0)) {
      toast.error("No timeline to render. Add some media first!");
      return;
    }

    handleRenderVideo(getTimelineData, timeline, isAutoSize ? null : width, isAutoSize ? null : height, getPixelsPerSecond);
    toast.info("Starting render...");
  }, [handleRenderVideo, getTimelineData, timeline, width, height, isAutoSize, timelineData, getPixelsPerSecond]);

  const handleLogTimelineData = useCallback(() => {
    if (timelineData.length === 0) {
      toast.error("Timeline is empty");
      return;
    }
    console.log(JSON.stringify(getTimelineData(), null, 2));
    toast.success("Timeline data logged to console");
  }, [getTimelineData, timelineData]);

  const handleWidthChange = useCallback((newWidth: number) => {
    setWidth(newWidth);
  }, []);

  const handleHeightChange = useCallback((newHeight: number) => {
    setHeight(newHeight);
  }, []);

  const commitWidth = useCallback(() => {
    const parsed = Number(widthInput);
    const safe = !isFinite(parsed) || parsed <= 0 ? 1920 : parsed;
    setWidth(safe);
    setWidthInput(String(safe));
  }, [widthInput]);

  const commitHeight = useCallback(() => {
    const parsed = Number(heightInput);
    const safe = !isFinite(parsed) || parsed <= 0 ? 1080 : parsed;
    setHeight(safe);
    setHeightInput(String(safe));
  }, [heightInput]);

  const handleAutoSizeChange = useCallback((auto: boolean) => {
    setIsAutoSize(auto);
  }, []);

  const handleAddTextClick = useCallback(() => {
    navigate("/editor/text-editor");
  }, [navigate]);

  const handleAddTrackClick = useCallback(() => {
    handleAddTrack();
  }, [handleAddTrack]);

  // Handler for multi-selection with Ctrl+click support
  const handleSelectScrubber = useCallback((scrubberId: string | null, ctrlKey: boolean = false) => {
    if (scrubberId === null) {
      setSelectedScrubberIds([]);
      return;
    }

    if (ctrlKey) {
      setSelectedScrubberIds(prev => {
        if (prev.includes(scrubberId)) {
          // If already selected, remove it
          return prev.filter(id => id !== scrubberId);
        } else {
          // If not selected, add it
          return [...prev, scrubberId];
        }
      });
    } else {
      // Normal click - select only this scrubber
      setSelectedScrubberIds([scrubberId]);
    }
  }, []);

  const handleSplitClick = useCallback(() => {
    if (selectedScrubberIds.length === 0) {
      toast.error("Please select a scrubber to split first!");
      return;
    }

    if (selectedScrubberIds.length > 1) {
      toast.error("Please select only one scrubber to split!");
      return;
    }

    if (timelineData.length === 0 ||
      timelineData.every((item) => item.scrubbers.length === 0)) {
      toast.error("No scrubbers to split. Add some media first!");
      return;
    }

    const splitCount = handleSplitScrubberAtRuler(rulerPositionPx, selectedScrubberIds[0]);
    if (splitCount === 0) {
      toast.info("Cannot split: ruler is not positioned within the selected scrubber");
    } else {
      setSelectedScrubberIds([]); // Clear selection since original scrubber is replaced
      toast.success(`Split the selected scrubber at ruler position`);
    }
  }, [handleSplitScrubberAtRuler, rulerPositionPx, selectedScrubberIds, timelineData]);

  // Handler for grouping selected scrubbers
  const handleGroupSelected = useCallback(() => {
    if (selectedScrubberIds.length < 2) {
      toast.error("Please select at least 2 scrubbers to group!");
      return;
    }

    handleGroupScrubbers(selectedScrubberIds);
    setSelectedScrubberIds([]); // Clear selection after grouping
    toast.success(`Grouped ${selectedScrubberIds.length} scrubbers`);
  }, [selectedScrubberIds, handleGroupScrubbers]);

  // Handler for ungrouping a grouped scrubber
  const handleUngroupSelected = useCallback((scrubberId: string) => {
    handleUngroupScrubber(scrubberId);
    setSelectedScrubberIds([]); // Clear selection after ungrouping
    toast.success("Ungrouped scrubber");
  }, [handleUngroupScrubber]);

  // Handler for moving grouped scrubber to media bin
  const handleMoveToMediaBinSelected = useCallback((scrubberId: string) => {
    handleMoveGroupToMediaBin(scrubberId, handleAddGroupToMediaBin);
    setSelectedScrubberIds([]); // Clear selection after moving
  }, [handleMoveGroupToMediaBin, handleAddGroupToMediaBin]);

  const handleApplyTranscriptEdit = useCallback(
    (request: ApplyTranscriptEditRequest): ApplyTranscriptEditResult => {
      const scrubberId = request.scrubberId;
      const targetTranscript = clipTranscripts[scrubberId];
      const timelineResult = handleCutScrubberWithSegments(
        scrubberId,
        request.segments.map((segment) => ({
          startSec: segment.startSec,
          endSec: segment.endSec,
        }))
      );

      if (!timelineResult.success) {
        return {
          success: false,
          scrubberId,
          newScrubberIds: [],
          error: timelineResult.error || "Failed to cut clip from transcript.",
        };
      }

      const replacement = timelineResult.newScrubbers;
      const replacementIds = replacement.map((scrubber) => scrubber.id);
      const baseName =
        targetTranscript?.scrubberName ||
        replacement[0]?.name ||
        scrubberId;
      const sourceWords = targetTranscript?.words || [];
      const now = new Date().toISOString();

      setSelectedScrubberIds((prev) =>
        prev.flatMap((id) => (id === scrubberId ? replacementIds : [id]))
      );

      setClipTranscripts((prev) => {
        const next = { ...prev };
        delete next[scrubberId];

        for (let index = 0; index < replacement.length; index++) {
          const scrubber = replacement[index];
          const clipStartSec = Math.max(0, (scrubber.trimBefore || 0) / FPS);
          const clipEndSec = Math.max(
            clipStartSec + 1 / FPS,
            scrubber.durationInSeconds - (scrubber.trimAfter || 0) / FPS
          );
          const words = sourceWords.filter(
            (word) =>
              word.start >= clipStartSec - 1 / FPS &&
              word.end <= clipEndSec + 1 / FPS
          );
          const fallbackSegment = request.segments[index];
          const text = words.length > 0
            ? words.map((word) => word.text).join(" ")
            : fallbackSegment?.text || "";

          next[scrubber.id] = {
            scrubberId: scrubber.id,
            scrubberName:
              replacement.length > 1
                ? `${baseName} (${index + 1}/${replacement.length})`
                : baseName,
            mediaType: scrubber.mediaType === "audio" ? "audio" : "video",
            text: text.trim(),
            words,
            clipStartSec,
            clipEndSec,
            error: null,
            updatedAt: now,
          };
        }

        return next;
      });

      return {
        success: true,
        scrubberId,
        newScrubberIds: replacementIds,
        error: null,
      };
    },
    [clipTranscripts, handleCutScrubberWithSegments]
  );

  const handleGenerateClipCaptions = useCallback(
    (request: GenerateClipCaptionsRequest): GenerateClipCaptionsResult => {
      return handleGenerateCaptionsFromTranscript(request);
    },
    [handleGenerateCaptionsFromTranscript]
  );

  const expandTimelineCallback = useCallback(() => {
    return expandTimeline(containerRef);
  }, [expandTimeline]);

  const handleScrollCallback = useCallback(() => {
    handleScroll(containerRef, expandTimelineCallback);
  }, [handleScroll, expandTimelineCallback]);

  // Play/pause controls with Player sync
  const [isPlaying, setIsPlaying] = useState(false);

  const togglePlayback = useCallback(() => {
    const player = playerRef.current;
    if (player) {
      if (player.isPlaying()) {
        player.pause();
        setIsPlaying(false);
      } else {
        player.play();
        setIsPlaying(true);
      }
    }
  }, []);

  // Sync player state with controls - simplified like original
  useEffect(() => {
    const player = playerRef.current;
    if (player) {
      const handlePlay: CallbackListener<"play"> = () => setIsPlaying(true);
      const handlePause: CallbackListener<"pause"> = () => setIsPlaying(false);
      const handleFrameUpdate: CallbackListener<"frameupdate"> = (e) => {
        // Update ruler position from player
        updateRulerFromPlayer(e.detail.frame);
      };

      player.addEventListener("play", handlePlay);
      player.addEventListener("pause", handlePause);
      player.addEventListener("frameupdate", handleFrameUpdate);

      return () => {
        player.removeEventListener("play", handlePlay);
        player.removeEventListener("pause", handlePause);
        player.removeEventListener("frameupdate", handleFrameUpdate);
      };
    }
  }, [updateRulerFromPlayer]);

  // Global spacebar play/pause functionality - like original
  useEffect(() => {
    const handleGlobalKeyPress = (event: KeyboardEvent) => {
      // Only handle spacebar when not focused on input elements
      if (event.code === "Space") {
        const target = event.target as HTMLElement;
        const isInputElement =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.contentEditable === "true" ||
          target.isContentEditable;

        // If user is typing in an input field, don't interfere
        if (isInputElement) {
          return;
        }

        // Prevent spacebar from scrolling the page
        event.preventDefault();

        const player = playerRef.current;
        if (player) {
          if (player.isPlaying()) {
            player.pause();
          } else {
            player.play();
          }
        }
      }
    };

    // Add event listener to document for global capture
    document.addEventListener("keydown", handleGlobalKeyPress);

    return () => {
      document.removeEventListener("keydown", handleGlobalKeyPress);
    };
  }, []); // Empty dependency array since we're accessing playerRef.current directly

  // Ruler mouse events
  useEffect(() => {
    if (isDraggingRuler) {
      const handleMouseMove = (e: MouseEvent) => handleRulerMouseMove(e, containerRef);
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleRulerMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleRulerMouseUp);
      };
    }
  }, [isDraggingRuler, handleRulerMouseMove, handleRulerMouseUp]);

  // Timeline wheel zoom functionality
  useEffect(() => {
    const timelineContainer = containerRef.current;
    if (!timelineContainer) return;

    const handleWheel = (e: WheelEvent) => {
      // Only zoom if Ctrl or Cmd is held
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const scrollDirection = e.deltaY > 0 ? -1 : 1;

        if (scrollDirection > 0) {
          handleZoomIn();
        } else {
          handleZoomOut();
        }
      }
    };

    timelineContainer.addEventListener("wheel", handleWheel, {
      passive: false,
    });
    return () => {
      timelineContainer.removeEventListener("wheel", handleWheel);
    };
  }, [handleZoomIn, handleZoomOut]);

  const { user, signOut } = useAuth();

  return (
    <div
      className="h-screen flex flex-col bg-background text-foreground"
      onPointerDown={(e: React.PointerEvent) => {
        if (e.button !== 0) {
          return;
        }
        setSelectedItem(null);
      }}>
      {/* Ultra-minimal Top Bar */}
      <header className="h-9 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/projects")}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title="Back to Projects"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </div>

        {/* Center project name */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="text-xs leading-none text-muted-foreground font-mono">{projectName || "Project"}</span>
        </div>

        <div className="flex items-center gap-1">
          {/* Save */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSaveTimeline}
            className="h-7 px-2 text-xs"
            title="Save timeline (Ctrl/Cmd+S)">
            Save
          </Button>

          {/* Theme Switcher */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title="Switch Theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* Main content: Left panel full height, center preview+timeline, right chat always visible */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Left Panel - Media Bin & Tools (full height) */}
        <ResizablePanel defaultSize={20} minSize={15} maxSize={40}>
          <div className="h-full border-r border-border">
            <LeftPanel
              mediaBinItems={mediaBinItems}
              isMediaLoading={isMediaLoading}
              onAddMedia={handleAddMediaToBin}
              onAddText={handleAddTextToBin}
              contextMenu={contextMenu}
              handleContextMenu={handleContextMenu}
              handleDeleteFromContext={handleDeleteFromContext}
              handleSplitAudioFromContext={handleSplitAudioFromContext}
              handleCloseContextMenu={handleCloseContextMenu}
              timeline={timeline}
              selectedScrubberIds={selectedScrubberIds}
              clipTranscripts={clipTranscripts}
              onClipTranscriptsChange={setClipTranscripts}
              onApplyTranscriptEdit={handleApplyTranscriptEdit}
              onGenerateClipCaptions={handleGenerateClipCaptions}
              projectId={projectId}
              onAddMediaClick={handleAddMediaClick}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Center Area: Preview and Timeline */}
        <ResizablePanel defaultSize={55}>
          <ResizablePanelGroup direction="vertical">
            {/* Preview Area */}
            <ResizablePanel defaultSize={65} minSize={40}>
              <div className="h-full flex flex-col bg-background">
                {/* Compact Top Bar */}
                <div className="h-8 border-b border-border/50 bg-muted/30 flex items-center justify-between px-3 shrink-0">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Resolution:</span>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        value={widthInput}
                        onChange={(e) => {
                          setWidthInput(e.target.value);
                          const n = Number(e.target.value);
                          if (isFinite(n) && n > 0) setWidth(n);
                        }}
                        onBlur={commitWidth}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            commitWidth();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                        disabled={isAutoSize}
                        className="h-5 w-14 text-xs px-1 border-0 bg-muted/50"
                        ref={widthInputRef}
                      />
                      <span>×</span>
                      <Input
                        type="number"
                        value={heightInput}
                        onChange={(e) => {
                          setHeightInput(e.target.value);
                          const n = Number(e.target.value);
                          if (isFinite(n) && n > 0) setHeight(n);
                        }}
                        onBlur={commitHeight}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            commitHeight();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                        disabled={isAutoSize}
                        className="h-5 w-14 text-xs px-1 border-0 bg-muted/50"
                        ref={heightInputRef}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <div className="flex items-center gap-1">
                      <Switch
                        id="auto-size"
                        checked={isAutoSize}
                        onCheckedChange={handleAutoSizeChange}
                        className="scale-75"
                      />
                      <Label htmlFor="auto-size" className="text-xs">
                        Auto
                      </Label>
                    </div>

                    {!isChatMinimized && null}
                    {isChatMinimized && (
                      <>
                        <Separator orientation="vertical" className="h-4 mx-1" />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsChatMinimized(false)}
                          className="h-6 w-6 p-0 text-primary"
                          title="Open Chat">
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Video Preview */}
                <div
                  className={
                    "flex-1 bg-zinc-200/70 dark:bg-zinc-900 " +
                    "flex flex-col items-center justify-center p-3 border border-border/50 rounded-lg overflow-hidden shadow-2xl relative"
                  }>
                  <div className="flex-1 flex items-center justify-center w-full">
                    <VideoPlayer
                      timelineData={timelineData}
                      durationInFrames={durationInFrames}
                      ref={playerRef}
                      compositionWidth={isAutoSize ? null : width}
                      compositionHeight={isAutoSize ? null : height}
                      timeline={timeline}
                      handleUpdateScrubber={handleUpdateScrubber}
                      selectedItem={selectedItem}
                      setSelectedItem={setSelectedItem}
                      getPixelsPerSecond={getPixelsPerSecond}
                    />
                  </div>

                  {/* Custom Video Controls - Below Player */}
                  <div className="w-full flex items-center justify-center gap-2 mt-3 px-4">
                    {/* Left side controls */}
                    <div className="flex items-center gap-1">
                      <MuteButton playerRef={playerRef} />
                    </div>

                    {/* Center play/pause button */}
                    <div className="flex items-center">
                      <Button variant="ghost" size="sm" onClick={togglePlayback} className="h-6 w-6 p-0">
                        {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      </Button>
                    </div>

                    {/* Right side controls */}
                    <div className="flex items-center gap-1">
                      <FullscreenButton playerRef={playerRef} />
                    </div>
                  </div>
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Timeline Area */}
            <ResizablePanel defaultSize={35} minSize={25}>
              <div className="h-full flex flex-col bg-muted/20">
                <div className="h-8 border-b border-border/50 bg-muted/30 flex items-center justify-between px-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">Timeline</span>
                    <Badge variant="outline" className="text-xs h-4 px-1.5 font-mono">
                      {Math.round(((durationInFrames || 0) / FPS) * 10) / 10}s
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={undo}
                      disabled={!canUndo}
                      className="h-6 w-6 p-0"
                      title="Undo (Ctrl/Cmd+Z)">
                      <CornerUpLeft className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={redo}
                      disabled={!canRedo}
                      className="h-6 w-6 p-0"
                      title="Redo (Ctrl/Cmd+Shift+Z)">
                      <CornerUpRight className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="flex items-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleZoomOut}
                        className="h-6 w-6 p-0 text-xs"
                        title="Zoom Out">
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Badge
                        variant="secondary"
                        className="text-xs h-4 px-1.5 font-mono cursor-pointer hover:bg-secondary/80 transition-colors"
                        onClick={handleZoomReset}
                        title="Click to reset zoom to 100%">
                        {Math.round(zoomLevel * 100)}%
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleZoomIn}
                        className="h-6 w-6 p-0 text-xs"
                        title="Zoom In">
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <Separator orientation="vertical" className="h-4 mx-1" />
                    <Button variant="ghost" size="sm" onClick={handleAddTrackClick} className="h-6 px-2 text-xs">
                      Track
                    </Button>
                    <Separator orientation="vertical" className="h-4 mx-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSplitClick}
                      className="h-6 px-2 text-xs"
                      title="Split selected scrubber at ruler position">
                      Split
                    </Button>
                    <Separator orientation="vertical" className="h-4 mx-1" />
                    <Button variant="ghost" size="sm" onClick={handleLogTimelineData} className="h-6 px-2 text-xs">
                      Debug
                    </Button>
                  </div>
                </div>

                <TimelineRuler
                  timelineWidth={timelineWidth}
                  rulerPositionPx={rulerPositionPx}
                  containerRef={containerRef}
                  onRulerDrag={handleRulerDrag}
                  onRulerMouseDown={handleRulerMouseDown}
                  pixelsPerSecond={getPixelsPerSecond()}
                  scrollLeft={containerRef.current?.scrollLeft || 0}
                />

                <TimelineTracks
                  timeline={timeline}
                  timelineWidth={timelineWidth}
                  rulerPositionPx={rulerPositionPx}
                  containerRef={containerRef}
                  onScroll={handleScrollCallback}
                  onDeleteTrack={handleDeleteTrack}
                  onUpdateScrubber={handleUpdateScrubberWithLocking}
                  onDeleteScrubber={handleDeleteScrubber}
                  onDropOnTrack={handleDropOnTrackWithAutoTranscribe}
                  onDropTransitionOnTrack={handleDropTransitionOnTrackWrapper}
                  onDeleteTransition={handleDeleteTransition}
                  getAllScrubbers={getAllScrubbers}
                  expandTimeline={expandTimelineCallback}
                  onRulerMouseDown={handleRulerMouseDown}
                  pixelsPerSecond={getPixelsPerSecond()}
                  selectedScrubberIds={selectedScrubberIds}
                  onSelectScrubber={handleSelectScrubber}
                  onGroupScrubbers={handleGroupSelected}
                  onUngroupScrubber={handleUngroupSelected}
                  onMoveToMediaBin={handleMoveToMediaBinSelected}
                  onBeginScrubberTransform={snapshotTimeline}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        {/* Right Panel - Chat + Media */}
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={25} minSize={18} maxSize={40}>
          <div className="h-full border-l border-border flex flex-col">
            {isChatMinimized ? (
              <div className="h-full min-h-0 p-3">
                <div className="h-full rounded-lg border border-border/50 bg-muted/20 flex items-start justify-end p-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsChatMinimized(false)}
                    className="h-6 px-2 text-xs"
                  >
                    Open Chat
                  </Button>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-0 flex flex-col">
                <ChatBox
                  className="flex-1 min-h-0"
                  mediaBinItems={mediaBinItems}
                  handleDropOnTrack={handleDropOnTrackWithAutoTranscribe}
                  isMinimized={false}
                  onToggleMinimize={() => setIsChatMinimized(true)}
                  messages={chatMessages}
                  onMessagesChange={setChatMessages}
                  timelineState={timeline}
                  handleUpdateScrubber={handleUpdateScrubberWithLocking}
                  handleDeleteScrubber={handleDeleteScrubber}
                />
                <div className="p-3 border-t border-border bg-background mt-auto">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleRenderClick}
                    disabled={isRendering}
                    className="w-full h-9 font-medium"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    {isRendering ? "Rendering..." : "Export"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,image/*,audio/*"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Render Status as Toast */}
      {renderStatus && (
        <div className="fixed bottom-4 right-4 z-50">
          <RenderStatus renderStatus={renderStatus} />
        </div>
      )}

    </div>
  );
}
