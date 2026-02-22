import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useOutletContext } from "react-router";
import { Copy, RefreshCw, Speech } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Separator } from "~/components/ui/separator";
import type {
  ApplyTranscriptEditRequest,
  ApplyTranscriptEditResult,
  ClipTranscriptRecord,
  ClipTranscriptSegment,
  ClipTranscriptsMap,
} from "~/components/media/captions.types";
import type { ScrubberState, TimelineState } from "~/components/timeline/types";
import {
  buildTranscribeJobFromScrubber,
  normalizeClipTranscriptRecord,
  requestClipTranscription,
  TRANSCRIPT_UNAVAILABLE_MESSAGE,
  type TranscribeClipJob,
} from "~/lib/clip-transcription";

export function loader() {
  return null;
}

interface CaptionsContext {
  timeline: TimelineState;
  selectedScrubberIds: string[];
  clipTranscripts: ClipTranscriptsMap;
  onClipTranscriptsChange: Dispatch<SetStateAction<ClipTranscriptsMap>>;
  onApplyTranscriptEdit: (
    request: ApplyTranscriptEditRequest
  ) => ApplyTranscriptEditResult;
  projectId?: string;
}

function findScrubber(timeline: TimelineState, scrubberId: string): ScrubberState | null {
  for (const track of timeline.tracks) {
    for (const scrubber of track.scrubbers) {
      if (scrubber.id === scrubberId) return scrubber;
    }
  }
  return null;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9']+/g, "");
}

function tokenizeEditedTranscript(value: string): string[] {
  const rawMatches = value.match(/[A-Za-z0-9']+/g) || [];
  return rawMatches
    .map((token) => normalizeToken(token))
    .filter((token) => token.length > 0);
}

function transcriptWordsToSegments(
  record: ClipTranscriptRecord,
  editedText: string
): ClipTranscriptSegment[] {
  if (!record.words.length) return [];

  const originalWords = record.words.filter((word) => {
    return (
      typeof word.text === "string" &&
      word.text.trim().length > 0 &&
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.end > word.start
    );
  });
  if (originalWords.length === 0) return [];

  const originalTokens = originalWords
    .map((word, index) => ({
      originalIndex: index,
      token: normalizeToken(word.text),
    }))
    .filter((item) => item.token.length > 0);

  if (originalTokens.length === 0) return [];

  const editedTokens = tokenizeEditedTranscript(editedText);
  if (editedTokens.length === 0) return [];

  const keptWordIndices: number[] = [];
  let searchFrom = 0;
  for (const editedToken of editedTokens) {
    let found = -1;
    for (let index = searchFrom; index < originalTokens.length; index++) {
      if (originalTokens[index].token === editedToken) {
        found = index;
        break;
      }
    }
    if (found < 0) continue;
    keptWordIndices.push(originalTokens[found].originalIndex);
    searchFrom = found + 1;
  }

  if (keptWordIndices.length === 0) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  let rangeStart = keptWordIndices[0];
  let previous = keptWordIndices[0];
  for (let i = 1; i < keptWordIndices.length; i++) {
    const current = keptWordIndices[i];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push({ start: rangeStart, end: previous });
    rangeStart = current;
    previous = current;
  }
  ranges.push({ start: rangeStart, end: previous });

  return ranges
    .map((range) => {
      const words = originalWords.slice(range.start, range.end + 1);
      if (!words.length) return null;
      const startSec = words[0].start;
      const endSec = words[words.length - 1].end;
      if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) {
        return null;
      }
      return {
        text: words.map((word) => word.text).join(" ").trim(),
        words,
        startSec,
        endSec,
      } satisfies ClipTranscriptSegment;
    })
    .filter((segment): segment is ClipTranscriptSegment => Boolean(segment));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export default function Captions() {
  const {
    timeline,
    selectedScrubberIds,
    clipTranscripts,
    onClipTranscriptsChange,
    onApplyTranscriptEdit,
    projectId,
  } = useOutletContext<CaptionsContext>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [editedTranscriptById, setEditedTranscriptById] = useState<
    Record<string, string>
  >({});

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

  useEffect(() => {
    setEditedTranscriptById((prev) => {
      const next: Record<string, string> = {};
      let changed = false;

      for (const [scrubberId, record] of Object.entries(clipTranscripts)) {
        if (Object.prototype.hasOwnProperty.call(prev, scrubberId)) {
          next[scrubberId] = prev[scrubberId];
        } else {
          next[scrubberId] = record.text;
          changed = true;
        }
      }

      if (Object.keys(prev).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [clipTranscripts]);

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

      const immediateRecords: ClipTranscriptsMap = {};
      const jobs: TranscribeClipJob[] = [];
      for (const scrubberId of targetIds) {
        const scrubber = findScrubber(timeline, scrubberId);
        if (!scrubber) {
          immediateRecords[scrubberId] = normalizeClipTranscriptRecord({
            scrubberId,
            scrubber: null,
            error: "Clip was not found in the timeline.",
          });
          continue;
        }
        const jobOrError = buildTranscribeJobFromScrubber(scrubber);
        if ("error" in jobOrError) {
          immediateRecords[scrubberId] = normalizeClipTranscriptRecord({
            scrubberId,
            scrubber,
            error: jobOrError.error,
          });
          continue;
        }

        jobs.push(jobOrError);
      }

      if (Object.keys(immediateRecords).length > 0) {
        onClipTranscriptsChange((prev) => ({ ...prev, ...immediateRecords }));
      }

      if (jobs.length === 0) {
        toast.error("No valid video/audio clips were selected.");
        return;
      }

      setIsSubmitting(true);
      setPendingIds(jobs.map((job) => job.scrubberId));
      try {
        const payload = await requestClipTranscription({
          projectId,
          jobs,
        });
        const byId = new Map(payload.results.map((result) => [result.scrubberId, result]));
        onClipTranscriptsChange((prev) => {
          const next = { ...prev };
          for (const job of jobs) {
            const scrubber = findScrubber(timeline, job.scrubberId);
            const result = byId.get(job.scrubberId);
            next[job.scrubberId] = normalizeClipTranscriptRecord({
              scrubberId: job.scrubberId,
              scrubber,
              result: result || null,
              error: result ? null : "No transcription result returned.",
            });
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
            next[job.scrubberId] = normalizeClipTranscriptRecord({
              scrubberId: job.scrubberId,
              scrubber,
              error: message,
            });
          }
          return next;
        });
        toast.error("Transcription failed. Check clip errors for details.");
      } finally {
        setIsSubmitting(false);
        setPendingIds([]);
      }
    },
    [isSubmitting, onClipTranscriptsChange, projectId, timeline]
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

  const handleEditedTranscriptChange = useCallback(
    (scrubberId: string, value: string) => {
      setEditedTranscriptById((prev) => ({
        ...prev,
        [scrubberId]: value,
      }));
    },
    []
  );

  const handleResetEditedTranscript = useCallback(
    (record: ClipTranscriptRecord) => {
      setEditedTranscriptById((prev) => ({
        ...prev,
        [record.scrubberId]: record.text,
      }));
    },
    []
  );

  const handleApplyEditedTranscript = useCallback(
    (scrubberId: string) => {
      const record = clipTranscripts[scrubberId];
      if (!record) {
        toast.error("Transcript record was not found.");
        return;
      }
      if (record.error) {
        toast.error("Retry transcription before applying transcript edits.");
        return;
      }
      if (!Array.isArray(record.words) || record.words.length === 0) {
        toast.error("Word timestamps are required to cut clips from transcript edits.");
        return;
      }
      const editedText = (editedTranscriptById[scrubberId] ?? record.text ?? "").trim();
      if (!editedText) {
        toast.error("Edited transcript is empty. Keep at least one word.");
        return;
      }

      const segments = transcriptWordsToSegments(record, editedText);
      if (segments.length === 0) {
        toast.error(
          "Could not align edited text with Whisper words. Keep original wording for sections you want to keep."
        );
        return;
      }

      const result = onApplyTranscriptEdit({
        scrubberId,
        editedText,
        segments,
      });

      if (!result.success) {
        toast.error(result.error || "Failed to apply transcript edit.");
        return;
      }

      const createdCount = result.newScrubberIds.length;
      toast.success(
        createdCount > 1
          ? `Applied transcript edit and created ${createdCount} clips.`
          : "Applied transcript edit to clip."
      );
    },
    [clipTranscripts, editedTranscriptById, onApplyTranscriptEdit]
  );

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
                const editedText =
                  editedTranscriptById[scrubberId] ?? record.text ?? "";
                const hasEdits = editedText.trim() !== (record.text || "").trim();
                const hasWordTimestamps =
                  Array.isArray(record.words) && record.words.length > 0;
                const unavailableMessage = record.error ||
                  (hasWordTimestamps ? null : TRANSCRIPT_UNAVAILABLE_MESSAGE);
                const clipDuration = Math.max(
                  0.001,
                  record.clipEndSec - record.clipStartSec
                );
                return (
                  <div
                    key={scrubberId}
                    className="rounded-md border border-border/50 bg-card p-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium truncate">{record.scrubberName}</p>
                      <Badge
                        variant={unavailableMessage ? "destructive" : "secondary"}
                        className="h-4 px-1.5 text-[10px] font-mono"
                      >
                        {unavailableMessage ? "error" : "ok"}
                      </Badge>
                    </div>

                    <p className="text-[10px] text-muted-foreground font-mono mt-1">
                      {record.clipStartSec.toFixed(2)}s - {record.clipEndSec.toFixed(2)}s
                    </p>

                    {unavailableMessage ? (
                      <p className="text-xs mt-2 text-destructive">{unavailableMessage}</p>
                    ) : null}

                    {!record.error ? (
                      <>
                        <div className="mt-2">
                          <p className="text-[10px] text-muted-foreground mb-1">
                            Editable Transcript
                          </p>
                          <textarea
                            value={editedText}
                            onChange={(event) =>
                              handleEditedTranscriptChange(
                                scrubberId,
                                event.target.value
                              )
                            }
                            rows={4}
                            className="w-full rounded border border-border/50 bg-background p-2 text-xs leading-relaxed resize-y min-h-20"
                            spellCheck={false}
                          />
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Keep words you want. Removed words are cut out of the clip.
                          </p>
                          <div className="mt-2 flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() => handleResetEditedTranscript(record)}
                              disabled={!hasEdits}
                            >
                              Reset
                            </Button>
                            <Button
                              variant="default"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() =>
                                handleApplyEditedTranscript(record.scrubberId)
                              }
                              disabled={!hasWordTimestamps}
                            >
                              Apply Edit Cut
                            </Button>
                          </div>
                        </div>
                        {hasWordTimestamps && !unavailableMessage && (
                          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_44px] gap-2 items-start">
                            <div className="rounded border border-border/40 bg-background p-2 max-h-36 overflow-y-auto panel-scrollbar">
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
                            <div className="rounded border border-border/40 bg-background p-1">
                              <p className="text-[9px] text-muted-foreground font-mono text-center">
                                {record.clipStartSec.toFixed(1)}s
                              </p>
                              <div className="relative h-32 my-1">
                                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border/90" />
                                {record.words.map((word) => {
                                  const relative = clamp(
                                    (word.start - record.clipStartSec) / clipDuration,
                                    0,
                                    1
                                  );
                                  return (
                                    <span
                                      key={`${record.scrubberId}-rail-${word.start}-${word.end}-${word.text}`}
                                      className="absolute left-1/2 h-0.5 w-3 -translate-x-1/2 -translate-y-1/2 rounded bg-primary/80"
                                      style={{ top: `${relative * 100}%` }}
                                      title={`${word.text} ${word.start.toFixed(2)}s`}
                                    />
                                  );
                                })}
                              </div>
                              <p className="text-[9px] text-muted-foreground font-mono text-center">
                                {record.clipEndSec.toFixed(1)}s
                              </p>
                            </div>
                          </div>
                        )}
                      </>
                    ) : null}
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
