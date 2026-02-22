import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from "react";
import { useOutletContext } from "react-router";
import { Copy, RefreshCw, Speech } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Separator } from "~/components/ui/separator";
import { Switch } from "~/components/ui/switch";
import { Label } from "~/components/ui/label";
import type {
  ClipTranscriptRecord,
  ClipTranscriptsMap,
  ClipTranscriptWord,
} from "~/components/media/captions.types";
import type { ScrubberState, TimelineState } from "~/components/timeline/types";
import { apiUrl } from "~/utils/api";
import { extractStorageKey } from "~/lib/media-persistence";

export function loader() {
  return null;
}

interface CaptionsContext {
  timeline: TimelineState;
  selectedScrubberIds: string[];
  clipTranscripts: ClipTranscriptsMap;
  onClipTranscriptsChange: Dispatch<SetStateAction<ClipTranscriptsMap>>;
  projectId?: string;
}

type TranscribeClipRequestItem = {
  scrubberId: string;
  name: string;
  mediaType: "video" | "audio";
  storageKey: string;
  durationInSeconds: number;
  trimBeforeFrames: number;
  trimAfterFrames: number;
};

type TranscribeClipResponseItem = {
  scrubberId: string;
  text: string;
  words: ClipTranscriptWord[];
  clipStartSec: number;
  clipEndSec: number;
  error: string | null;
};

type TranscribeResponse = {
  model: string;
  timestamps: string;
  results: TranscribeClipResponseItem[];
};

function findScrubber(timeline: TimelineState, scrubberId: string): ScrubberState | null {
  for (const track of timeline.tracks) {
    for (const scrubber of track.scrubbers) {
      if (scrubber.id === scrubberId) return scrubber;
    }
  }
  return null;
}

function buildErrorRecord(
  scrubberId: string,
  scrubber: ScrubberState | null,
  message: string
): ClipTranscriptRecord {
  const mediaType =
    scrubber?.mediaType === "audio" ? "audio" : "video";
  return {
    scrubberId,
    scrubberName: scrubber?.name || scrubberId,
    mediaType,
    text: "",
    words: [],
    clipStartSec: 0,
    clipEndSec: 0,
    error: message,
    updatedAt: new Date().toISOString(),
  };
}

export default function Captions() {
  const {
    timeline,
    selectedScrubberIds,
    clipTranscripts,
    onClipTranscriptsChange,
    projectId,
  } = useOutletContext<CaptionsContext>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [useLegacyWhisper, setUseLegacyWhisper] = useState(false);

  const selectedScrubbers = useMemo(() => {
    return selectedScrubberIds
      .map((id) => findScrubber(timeline, id))
      .filter((scrubber): scrubber is ScrubberState => scrubber !== null);
  }, [selectedScrubberIds, timeline]);

  const transcriptDisplayIds = useMemo(() => {
    if (selectedScrubberIds.length > 0) {
      return selectedScrubberIds;
    }
    return Object.keys(clipTranscripts);
  }, [selectedScrubberIds, clipTranscripts]);

  const retryIds = useMemo(() => {
    const selectedFailed = selectedScrubberIds.filter(
      (id) => clipTranscripts[id]?.error
    );
    if (selectedFailed.length > 0) return selectedFailed;
    return Object.keys(clipTranscripts).filter((id) => clipTranscripts[id]?.error);
  }, [clipTranscripts, selectedScrubberIds]);

  const transcribeIds = useCallback(
    async (targetIds: string[]) => {
      if (targetIds.length === 0) {
        toast.error("Select at least one clip to transcribe.");
        return;
      }
      if (isSubmitting) {
        toast.info("A transcription request is already in progress.");
        return;
      }

      const immediateErrors: ClipTranscriptsMap = {};
      const jobs: TranscribeClipRequestItem[] = [];
      for (const scrubberId of targetIds) {
        const scrubber = findScrubber(timeline, scrubberId);
        if (!scrubber) {
          immediateErrors[scrubberId] = buildErrorRecord(
            scrubberId,
            null,
            "Clip was not found in the timeline."
          );
          continue;
        }
        if (scrubber.mediaType !== "video" && scrubber.mediaType !== "audio") {
          immediateErrors[scrubberId] = buildErrorRecord(
            scrubberId,
            scrubber,
            `Unsupported media type for transcription: ${scrubber.mediaType}`
          );
          continue;
        }
        const storageKey =
          scrubber.storageKey || extractStorageKey(scrubber.mediaUrlRemote);
        if (!storageKey) {
          immediateErrors[scrubberId] = buildErrorRecord(
            scrubberId,
            scrubber,
            "Clip has no server media asset. Re-import media and try again."
          );
          continue;
        }
        if (!Number.isFinite(scrubber.durationInSeconds) || scrubber.durationInSeconds <= 0) {
          immediateErrors[scrubberId] = buildErrorRecord(
            scrubberId,
            scrubber,
            "Clip has no valid duration."
          );
          continue;
        }

        jobs.push({
          scrubberId,
          name: scrubber.name,
          mediaType: scrubber.mediaType,
          storageKey,
          durationInSeconds: scrubber.durationInSeconds,
          trimBeforeFrames: scrubber.trimBefore ?? 0,
          trimAfterFrames: scrubber.trimAfter ?? 0,
        });
      }

      if (Object.keys(immediateErrors).length > 0) {
        onClipTranscriptsChange((prev) => ({ ...prev, ...immediateErrors }));
      }

      if (jobs.length === 0) {
        toast.error("No valid video/audio clips were selected.");
        return;
      }

      setIsSubmitting(true);
      setPendingIds(jobs.map((job) => job.scrubberId));
      try {
        const response = await fetch(apiUrl("/transcribe-clips"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            model: "openai/whisper-small",
            timestamps: "word",
            clips: jobs,
            useLegacyWhisper,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || "Transcription request failed.");
        }

        const payload = (await response.json()) as TranscribeResponse;
        const byId = new Map(payload.results.map((result) => [result.scrubberId, result]));
        onClipTranscriptsChange((prev) => {
          const next = { ...prev };
          for (const job of jobs) {
            const scrubber = findScrubber(timeline, job.scrubberId);
            const result = byId.get(job.scrubberId);
            if (!result) {
              next[job.scrubberId] = buildErrorRecord(
                job.scrubberId,
                scrubber,
                "No transcription result returned for this clip."
              );
              continue;
            }

            const words = Array.isArray(result.words)
              ? result.words
                  .filter((word) => {
                    return (
                      typeof word.text === "string" &&
                      word.text.trim().length > 0 &&
                      Number.isFinite(word.start) &&
                      Number.isFinite(word.end)
                    );
                  })
                  .map((word) => ({
                    text: word.text.trim(),
                    start: Number(word.start),
                    end: Number(word.end),
                  }))
              : [];

            const mediaType = scrubber?.mediaType === "audio" ? "audio" : "video";
            next[job.scrubberId] = {
              scrubberId: job.scrubberId,
              scrubberName: scrubber?.name || job.name || job.scrubberId,
              mediaType,
              text: typeof result.text === "string" ? result.text.trim() : "",
              words,
              clipStartSec: Number.isFinite(result.clipStartSec)
                ? Number(result.clipStartSec)
                : 0,
              clipEndSec: Number.isFinite(result.clipEndSec)
                ? Number(result.clipEndSec)
                : 0,
              error: result.error ? String(result.error) : null,
              updatedAt: new Date().toISOString(),
            };
          }
          return next;
        });

        toast.success("Transcription complete.");
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to transcribe selected clips.";
        onClipTranscriptsChange((prev) => {
          const next = { ...prev };
          for (const job of jobs) {
            const scrubber = findScrubber(timeline, job.scrubberId);
            next[job.scrubberId] = buildErrorRecord(
              job.scrubberId,
              scrubber,
              message
            );
          }
          return next;
        });
        toast.error("Transcription failed. Check clip errors for details.");
      } finally {
        setIsSubmitting(false);
        setPendingIds([]);
      }
    },
    [isSubmitting, onClipTranscriptsChange, projectId, timeline, useLegacyWhisper]
  );

  const handleTranscribeSelected = useCallback(() => {
    void transcribeIds(selectedScrubberIds);
  }, [selectedScrubberIds, transcribeIds]);

  const handleRetryFailed = useCallback(() => {
    void transcribeIds(retryIds);
  }, [retryIds, transcribeIds]);

  const handleCopyTranscript = useCallback(async () => {
    const idsToCopy = selectedScrubberIds.length > 0 ? selectedScrubberIds : Object.keys(clipTranscripts);
    const blocks = idsToCopy
      .map((id) => clipTranscripts[id])
      .filter((record): record is ClipTranscriptRecord => Boolean(record && record.text))
      .map((record) => `[${record.scrubberName}]\n${record.text}`);
    if (blocks.length === 0) {
      toast.info("No transcript text available to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(blocks.join("\n\n"));
      toast.success("Transcript copied to clipboard.");
    } catch {
      toast.error("Could not access clipboard.");
    }
  }, [clipTranscripts, selectedScrubberIds]);

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="px-2 py-2 border-b border-border/50 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Speech className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-xs font-medium truncate">Clip Transcription</p>
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-mono">
            {selectedScrubberIds.length} selected
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={handleCopyTranscript}
          >
            <Copy className="h-3 w-3 mr-1" />
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={isSubmitting || retryIds.length === 0}
            onClick={handleRetryFailed}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry Failed
          </Button>
          <Button
            variant="default"
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={isSubmitting || selectedScrubberIds.length === 0}
            onClick={handleTranscribeSelected}
          >
            {isSubmitting ? "Transcribing..." : "Transcribe Selected"}
          </Button>
        </div>
      </div>
      <div className="px-2 py-1 border-b border-border/30 flex items-center gap-2">
        <Switch
          id="use-legacy-whisper"
          checked={useLegacyWhisper}
          onCheckedChange={setUseLegacyWhisper}
        />
        <Label
          htmlFor="use-legacy-whisper"
          className="text-[10px] text-muted-foreground cursor-pointer"
        >
          Use legacy Whisper (transformers) for testing
        </Label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto panel-scrollbar p-2 space-y-2">
        {selectedScrubbers.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <p className="text-xs text-muted-foreground text-center px-4">
              Select video or audio clips on the timeline, then click
              {" "}
              <span className="font-medium text-foreground">Transcribe Selected</span>.
            </p>
          </div>
        )}

        {selectedScrubbers.length > 0 && (
          <div className="rounded-md border border-border/50 bg-card p-2">
            <p className="text-[11px] font-medium text-muted-foreground mb-2">Selected Clips</p>
            <div className="space-y-1">
              {selectedScrubbers.map((scrubber) => {
                const transcript = clipTranscripts[scrubber.id];
                const isPending = pendingIds.includes(scrubber.id);
                const status = isPending
                  ? "pending"
                  : transcript?.error
                    ? "error"
                    : transcript?.text
                      ? "ready"
                      : "idle";

                return (
                  <div
                    key={scrubber.id}
                    className="flex items-center justify-between gap-2 rounded border border-border/30 bg-background px-2 py-1"
                  >
                    <div className="min-w-0">
                      <p className="text-xs truncate">{scrubber.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {scrubber.mediaType}
                      </p>
                    </div>
                    <Badge
                      variant={status === "error" ? "destructive" : "secondary"}
                      className="h-4 px-1.5 text-[10px] font-mono"
                    >
                      {status}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {transcriptDisplayIds.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              {transcriptDisplayIds.map((scrubberId) => {
                const record = clipTranscripts[scrubberId];
                if (!record) return null;
                return (
                  <div
                    key={scrubberId}
                    className="rounded-md border border-border/50 bg-card p-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium truncate">{record.scrubberName}</p>
                      <Badge
                        variant={record.error ? "destructive" : "secondary"}
                        className="h-4 px-1.5 text-[10px] font-mono"
                      >
                        {record.error ? "error" : "ok"}
                      </Badge>
                    </div>

                    <p className="text-[10px] text-muted-foreground font-mono mt-1">
                      {record.clipStartSec.toFixed(2)}s - {record.clipEndSec.toFixed(2)}s
                    </p>

                    {record.error ? (
                      <p className="text-xs text-destructive mt-2">{record.error}</p>
                    ) : (
                      <>
                        <p className="text-xs mt-2 whitespace-pre-wrap leading-relaxed">
                          {record.text || "(No transcript text returned)"}
                        </p>
                        {record.words.length > 0 && (
                          <div className="mt-2 rounded border border-border/40 bg-background p-2 max-h-36 overflow-y-auto panel-scrollbar">
                            <p className="text-[10px] text-muted-foreground mb-1">Word Timestamps</p>
                            <div className="flex flex-wrap gap-1">
                              {record.words.map((word) => (
                                <span
                                  key={`${record.scrubberId}-${word.start}-${word.end}-${word.text}`}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono"
                                >
                                  {word.text} [{word.start.toFixed(2)}-{word.end.toFixed(2)}]
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
