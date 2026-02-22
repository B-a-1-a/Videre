import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Plus,
  Search,
  Sparkles,
  Type,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type {
  ClipTranscriptRecord,
  ClipTranscriptWord,
  ClipTranscriptsMap,
  GenerateClipCaptionsRequest,
  GenerateClipCaptionsResult,
} from "~/components/media/captions.types";
import type { ScrubberState, TimelineState } from "~/components/timeline/types";
import {
  buildTranscribeJobFromScrubber,
  normalizeClipTranscriptRecord,
  requestClipTranscription,
} from "~/lib/clip-transcription";
import { cn } from "~/lib/utils";

interface TextEditorContext {
  onAddText: (
    textContent: string,
    fontSize: number,
    fontFamily: string,
    color: string,
    textAlign: "left" | "center" | "right",
    fontWeight: "normal" | "bold"
  ) => void;
  timeline: TimelineState;
  selectedScrubberIds: string[];
  clipTranscripts: ClipTranscriptsMap;
  onClipTranscriptsChange: React.Dispatch<React.SetStateAction<ClipTranscriptsMap>>;
  onGenerateClipCaptions: (
    request: GenerateClipCaptionsRequest
  ) => GenerateClipCaptionsResult;
  projectId?: string;
}

type FontOption = {
  label: string;
  value: string;
  category: "Sans" | "Serif" | "Display" | "Mono";
};

const FONT_OPTIONS: FontOption[] = [
  {
    label: "Inter",
    value: "Inter, ui-sans-serif, system-ui, sans-serif",
    category: "Sans",
  },
  {
    label: "Manrope",
    value: "Manrope, Inter, ui-sans-serif, system-ui, sans-serif",
    category: "Sans",
  },
  {
    label: "Plus Jakarta Sans",
    value: "'Plus Jakarta Sans', Inter, ui-sans-serif, system-ui, sans-serif",
    category: "Sans",
  },
  {
    label: "Poppins",
    value: "Poppins, Inter, ui-sans-serif, system-ui, sans-serif",
    category: "Sans",
  },
  {
    label: "Nunito Sans",
    value: "'Nunito Sans', Inter, ui-sans-serif, system-ui, sans-serif",
    category: "Sans",
  },
  {
    label: "Merriweather",
    value: "Merriweather, Georgia, 'Times New Roman', serif",
    category: "Serif",
  },
  {
    label: "Playfair Display",
    value: "'Playfair Display', Georgia, 'Times New Roman', serif",
    category: "Serif",
  },
  {
    label: "Space Grotesk",
    value: "'Space Grotesk', Inter, ui-sans-serif, system-ui, sans-serif",
    category: "Display",
  },
  {
    label: "Bebas Neue",
    value: "'Bebas Neue', Impact, 'Arial Narrow', sans-serif",
    category: "Display",
  },
  {
    label: "JetBrains Mono",
    value: "'JetBrains Mono', Menlo, Consolas, monospace",
    category: "Mono",
  },
];

const STYLE_PRESETS: Array<{
  id: string;
  label: string;
  font: string;
  size: number;
  weight: "normal" | "bold";
  align: "left" | "center" | "right";
}> = [
    {
      id: "clean-subtitle",
      label: "Clean Subtitle",
      font: "Inter, ui-sans-serif, system-ui, sans-serif",
      size: 54,
      weight: "normal",
      align: "center",
    },
    {
      id: "bold-impact",
      label: "Bold Impact",
      font: "'Bebas Neue', Impact, 'Arial Narrow', sans-serif",
      size: 64,
      weight: "bold",
      align: "center",
    },
    {
      id: "doc-style",
      label: "Doc Style",
      font: "'Nunito Sans', Inter, ui-sans-serif, system-ui, sans-serif",
      size: 48,
      weight: "normal",
      align: "left",
    },
    {
      id: "tech-mono",
      label: "Tech Mono",
      font: "'JetBrains Mono', Menlo, Consolas, monospace",
      size: 46,
      weight: "bold",
      align: "center",
    },
  ];

const WORDS_PER_CAPTION_OPTIONS = [2, 3, 4, 5, 6, 7];
const MAX_CAPTION_DURATION_SEC = 2.8;
const WORD_GAP_SPLIT_SEC = 0.6;

function findScrubberById(
  timeline: TimelineState,
  scrubberId: string
): ScrubberState | null {
  for (const track of timeline.tracks) {
    for (const scrubber of track.scrubbers) {
      if (scrubber.id === scrubberId) return scrubber;
    }
  }
  return null;
}

function isValidWord(word: ClipTranscriptWord): boolean {
  return (
    typeof word.text === "string" &&
    word.text.trim().length > 0 &&
    Number.isFinite(word.start) &&
    Number.isFinite(word.end) &&
    word.end > word.start
  );
}

function collapseCaptionText(words: ClipTranscriptWord[]): string {
  return words
    .map((word) => word.text.trim())
    .join(" ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCaptionSegmentsFromWords(
  words: ClipTranscriptWord[],
  wordsPerCaption: number
): GenerateClipCaptionsRequest["segments"] {
  const safeMaxWords = Math.max(1, Math.min(12, Math.round(wordsPerCaption)));
  const sortedWords = words
    .filter(isValidWord)
    .sort((a, b) => a.start - b.start);

  if (sortedWords.length === 0) return [];

  const chunks: ClipTranscriptWord[][] = [];
  let currentChunk: ClipTranscriptWord[] = [];

  for (const word of sortedWords) {
    if (currentChunk.length === 0) {
      currentChunk = [word];
      continue;
    }

    const previousWord = currentChunk[currentChunk.length - 1];
    const proposedDuration = word.end - currentChunk[0].start;
    const gapFromPrevious = word.start - previousWord.end;
    const shouldSplit =
      currentChunk.length >= safeMaxWords ||
      proposedDuration > MAX_CAPTION_DURATION_SEC ||
      gapFromPrevious > WORD_GAP_SPLIT_SEC;

    if (shouldSplit) {
      chunks.push(currentChunk);
      currentChunk = [word];
      continue;
    }

    currentChunk.push(word);
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks
    .map((chunk) => {
      const startSec = chunk[0]?.start ?? 0;
      const endSec = chunk[chunk.length - 1]?.end ?? startSec;
      const text = collapseCaptionText(chunk);
      const result: GenerateClipCaptionsRequest["segments"][number] = {
        text,
        words: chunk,
        startSec,
        endSec,
      };
      return result;
    })
    .filter((segment): segment is GenerateClipCaptionsRequest["segments"][number] => Boolean(segment));
}

export default function TextEditor() {
  const {
    onAddText,
    timeline,
    selectedScrubberIds,
    clipTranscripts,
    onClipTranscriptsChange,
    onGenerateClipCaptions,
    projectId,
  } = useOutletContext<TextEditorContext>();
  const navigate = useNavigate();

  const [textContent, setTextContent] = useState("Hello World");
  const [fontSize, setFontSize] = useState(56);
  const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0].value);
  const [color, setColor] = useState("#FFFFFF");
  const [textAlign, setTextAlign] = useState<"left" | "center" | "right">(
    "center"
  );
  const [fontWeight, setFontWeight] = useState<"normal" | "bold">("normal");
  const [fontQuery, setFontQuery] = useState("");
  const [referenceScrubberId, setReferenceScrubberId] = useState("");
  const [wordsPerCaption, setWordsPerCaption] = useState(4);
  const [captionStyle, setCaptionStyle] = useState<"normal" | "dynamic">("normal");
  const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false);

  const referenceCandidates = useMemo(() => {
    return timeline.tracks.flatMap((track, trackIndex) =>
      track.scrubbers
        .filter(
          (scrubber) =>
            scrubber.mediaType === "video" || scrubber.mediaType === "audio"
        )
        .sort((a, b) => a.left - b.left)
        .map((scrubber) => ({
          scrubber,
          trackIndex,
          transcript: clipTranscripts[scrubber.id] || null,
        }))
    );
  }, [clipTranscripts, timeline]);

  useEffect(() => {
    const selectedReference = selectedScrubberIds.find((id) =>
      referenceCandidates.some((candidate) => candidate.scrubber.id === id)
    );

    if (selectedReference && selectedReference !== referenceScrubberId) {
      setReferenceScrubberId(selectedReference);
      return;
    }

    const hasCurrentReference = referenceCandidates.some(
      (candidate) => candidate.scrubber.id === referenceScrubberId
    );
    if (!hasCurrentReference) {
      setReferenceScrubberId(referenceCandidates[0]?.scrubber.id || "");
    }
  }, [referenceCandidates, referenceScrubberId, selectedScrubberIds]);

  const selectedReference = useMemo(() => {
    return (
      referenceCandidates.find(
        (candidate) => candidate.scrubber.id === referenceScrubberId
      ) || null
    );
  }, [referenceCandidates, referenceScrubberId]);

  const filteredFonts = useMemo(() => {
    const query = fontQuery.trim().toLowerCase();
    if (!query) return FONT_OPTIONS;
    return FONT_OPTIONS.filter((font) => {
      return (
        font.label.toLowerCase().includes(query) ||
        font.category.toLowerCase().includes(query)
      );
    });
  }, [fontQuery]);

  const selectedFontLabel = useMemo(() => {
    return (
      FONT_OPTIONS.find((font) => font.value === fontFamily)?.label || "Custom"
    );
  }, [fontFamily]);

  const transcriptAvailability = useMemo(() => {
    if (!selectedReference) return "none";
    const transcript = clipTranscripts[selectedReference.scrubber.id];
    if (!transcript) return "missing";
    if (transcript.error) return "error";
    if (Array.isArray(transcript.words) && transcript.words.length > 0)
      return "ready";
    return "missing";
  }, [clipTranscripts, selectedReference]);

  const applyStylePreset = useCallback(
    (presetId: string) => {
      const preset = STYLE_PRESETS.find((item) => item.id === presetId);
      if (!preset) return;
      setFontFamily(preset.font);
      setFontSize(preset.size);
      setFontWeight(preset.weight);
      setTextAlign(preset.align);
    },
    []
  );

  const ensureTranscriptRecord = useCallback(
    async (scrubber: ScrubberState): Promise<ClipTranscriptRecord | null> => {
      const currentRecord = clipTranscripts[scrubber.id];
      if (
        currentRecord &&
        !currentRecord.error &&
        Array.isArray(currentRecord.words) &&
        currentRecord.words.length > 0
      ) {
        return currentRecord;
      }

      const jobOrError = buildTranscribeJobFromScrubber(scrubber);
      if ("error" in jobOrError) {
        toast.error(jobOrError.error);
        return null;
      }

      const payload = await requestClipTranscription({
        projectId,
        jobs: [jobOrError],
      });
      const result = payload.results.find(
        (item) => item.scrubberId === scrubber.id
      );
      const normalized = normalizeClipTranscriptRecord({
        scrubberId: scrubber.id,
        scrubber,
        result: result || null,
        error: result ? null : "No transcription result returned.",
      });

      onClipTranscriptsChange((prev) => ({
        ...prev,
        [scrubber.id]: normalized,
      }));

      return normalized.error ? null : normalized;
    },
    [clipTranscripts, onClipTranscriptsChange, projectId]
  );

  const handleAddStaticText = useCallback(() => {
    if (!textContent.trim()) return;
    onAddText(textContent, fontSize, fontFamily, color, textAlign, fontWeight);
    navigate("../media-bin");
  }, [
    color,
    fontFamily,
    fontSize,
    fontWeight,
    navigate,
    onAddText,
    textAlign,
    textContent,
  ]);

  const handleGenerateCaptions = useCallback(async () => {
    if (!referenceScrubberId) {
      toast.error("Select a reference clip first.");
      return;
    }
    const scrubber =
      findScrubberById(timeline, referenceScrubberId) || selectedReference?.scrubber;
    if (!scrubber) {
      toast.error("Reference clip was not found in the timeline.");
      return;
    }

    setIsGeneratingCaptions(true);
    try {
      const transcript = await ensureTranscriptRecord(scrubber);
      if (!transcript) {
        toast.error("Transcript with word timestamps is required.");
        return;
      }

      const captionSegments = buildCaptionSegmentsFromWords(
        transcript.words,
        wordsPerCaption
      );
      if (captionSegments.length === 0) {
        toast.error("No timed caption segments could be generated.");
        return;
      }

      const result = onGenerateClipCaptions({
        referenceScrubberId: scrubber.id,
        segments: captionSegments,
        textStyle: {
          fontSize,
          fontFamily,
          color,
          textAlign,
          fontWeight,
          template: captionStyle,
        },
        replaceExisting: true,
      });

      if (!result.success) {
        toast.error(result.error || "Failed to generate timed captions.");
        return;
      }

      toast.success(
        `Generated ${result.createdScrubberIds.length} timed captions from ${scrubber.name}.`
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to generate captions from transcript.";
      toast.error(message);
    } finally {
      setIsGeneratingCaptions(false);
    }
  }, [
    color,
    ensureTranscriptRecord,
    fontFamily,
    fontSize,
    fontWeight,
    onGenerateClipCaptions,
    referenceScrubberId,
    selectedReference,
    captionStyle,
    textAlign,
    timeline,
    wordsPerCaption,
  ]);

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex-1 overflow-y-auto panel-scrollbar p-3 pt-8">
        <Card className="relative overflow-hidden border-border/70 bg-card/85 shadow-md">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-r from-primary/20 via-primary/5 to-transparent" />
          <CardHeader className="relative pb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm">Text & Captions</CardTitle>
              </div>
              <Badge variant="secondary" className="h-5 px-2 text-[10px]">
                Modern Typography
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Pick a style once, then auto-generate timed captions from your
              reference clip transcript.
            </p>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-medium">Font Selector</Label>
                <Badge variant="outline" className="h-5 px-2 text-[10px]">
                  {filteredFonts.length} fonts
                </Badge>
              </div>
              <Input
                value={fontQuery}
                onChange={(event) => setFontQuery(event.target.value)}
                placeholder="Search font name or category..."
                className="h-8 text-xs"
              />
              <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto panel-scrollbar pr-1">
                {filteredFonts.map((font) => {
                  const isActive = font.value === fontFamily;
                  return (
                    <button
                      key={font.label}
                      type="button"
                      onClick={() => setFontFamily(font.value)}
                      className={cn(
                        "rounded-lg border px-2 py-2 text-left transition-all",
                        "hover:-translate-y-0.5 hover:shadow-md",
                        isActive
                          ? "border-primary/60 bg-primary/10 shadow"
                          : "border-border/70 bg-muted/20"
                      )}
                    >
                      <p
                        className="text-sm leading-none"
                        style={{ fontFamily: font.value }}
                      >
                        Ag
                      </p>
                      <p
                        className="mt-1 truncate text-[11px] font-medium"
                        style={{ fontFamily: font.value }}
                      >
                        {font.label}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {font.category}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium">Caption Style</Label>
              <div className="grid grid-cols-2 rounded-md border border-border/70 overflow-hidden">
                <Button
                  type="button"
                  variant={captionStyle === "normal" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setCaptionStyle("normal")}
                  className="h-8 rounded-none border-0 text-xs"
                >
                  Static
                </Button>
                <Button
                  type="button"
                  variant={captionStyle === "dynamic" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setCaptionStyle("dynamic")}
                  className="h-8 rounded-none border-0 text-xs"
                >
                  Dynamic
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium">Style Presets</Label>
              <div className="grid grid-cols-2 gap-2">
                {STYLE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyStylePreset(preset.id)}
                    className="rounded-md border border-border/70 bg-muted/20 px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-muted/40"
                  >
                    <p className="font-medium">{preset.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {preset.size}px ·{" "}
                      {preset.weight === "bold" ? "Bold" : "Regular"}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs font-medium">Size</Label>
                <Input
                  type="number"
                  min="12"
                  max="220"
                  value={fontSize}
                  onChange={(event) =>
                    setFontSize(Math.max(12, Number(event.target.value) || 56))
                  }
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Font Family</Label>
                <div className="h-8 rounded-md border border-border/70 bg-muted/25 px-2 text-xs flex items-center">
                  <span className="truncate" style={{ fontFamily }}>
                    {selectedFontLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Alignment</Label>
                <div className="grid grid-cols-3 rounded-md border border-border/70 overflow-hidden">
                  {(
                    [
                      { value: "left", label: "Left" },
                      { value: "center", label: "Center" },
                      { value: "right", label: "Right" },
                    ] as const
                  ).map(({ value, label }) => (
                    <Button
                      key={value}
                      type="button"
                      variant={textAlign === value ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setTextAlign(value)}
                      className="h-8 rounded-none border-0 text-[10px]"
                      title={label}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Weight</Label>
                <div className="grid grid-cols-2 rounded-md border border-border/70 overflow-hidden">
                  <Button
                    type="button"
                    variant={fontWeight === "normal" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setFontWeight("normal")}
                    className="h-8 rounded-none border-0 text-xs"
                  >
                    Normal
                  </Button>
                  <Button
                    type="button"
                    variant={fontWeight === "bold" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setFontWeight("bold")}
                    className="h-8 rounded-none border-0 text-xs"
                  >
                    Bold
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value.toUpperCase())}
                  className="h-8 w-12 rounded border border-border/70 bg-muted/20 p-0.5"
                />
                <Badge variant="outline" className="h-8 px-2 font-mono text-xs">
                  {color}
                </Badge>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium">Live Preview</Label>
              <div
                className="rounded-lg border border-border/70 bg-gradient-to-b from-muted/35 to-muted/10 px-3 py-5"
                style={{ textAlign }}
              >
                <p
                  style={{
                    color,
                    fontFamily,
                    fontWeight,
                    fontSize: `${Math.min(36, Math.max(14, fontSize * 0.35))}px`,
                    margin: 0,
                  }}
                >
                  {textContent || "Type to preview"}
                </p>
              </div>
            </div>

            <Separator />

            <div className="space-y-3 rounded-lg border border-border/70 bg-muted/15 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-medium">
                    Auto Captions From Reference Clip
                  </Label>
                </div>
                <Badge
                  variant={
                    transcriptAvailability === "error"
                      ? "destructive"
                      : "secondary"
                  }
                  className="h-5 px-2 text-[10px]"
                >
                  {transcriptAvailability === "ready"
                    ? "Transcript Ready"
                    : transcriptAvailability === "error"
                      ? "Transcript Error"
                      : "Will Transcribe"}
                </Badge>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Reference Clip
                </Label>
                <Select
                  value={referenceScrubberId}
                  onValueChange={setReferenceScrubberId}
                >
                  <SelectTrigger className="w-full h-8 text-xs">
                    <SelectValue placeholder="Select video/audio clip" />
                  </SelectTrigger>
                  <SelectContent>
                    {referenceCandidates.map((candidate) => (
                      <SelectItem
                        key={candidate.scrubber.id}
                        value={candidate.scrubber.id}
                        className="text-xs"
                      >
                        Track {candidate.trackIndex + 1} · {candidate.scrubber.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Caption Density (words per subtitle)
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {WORDS_PER_CAPTION_OPTIONS.map((value) => (
                    <Button
                      key={value}
                      type="button"
                      variant={wordsPerCaption === value ? "default" : "ghost"}
                      size="sm"
                      className="h-7 min-w-8 px-2 text-xs"
                      onClick={() => setWordsPerCaption(value)}
                    >
                      {value}
                    </Button>
                  ))}
                </div>
              </div>

              <Button
                type="button"
                onClick={handleGenerateCaptions}
                disabled={isGeneratingCaptions || !referenceScrubberId}
                className="w-full h-9"
                size="sm"
              >
                {isGeneratingCaptions
                  ? "Generating Timed Captions..."
                  : "Generate Timed Captions"}
              </Button>
            </div>

            <div className="space-y-3 rounded-lg border border-border/70 bg-muted/15 p-3">
              <div className="space-y-2">
                <Label className="text-xs font-medium">Text Content</Label>
                <textarea
                  value={textContent}
                  onChange={(event) => setTextContent(event.target.value)}
                  className="w-full h-20 rounded-lg border border-border/70 bg-muted/30 p-3 text-sm text-foreground shadow-inner focus:outline-none focus:ring-2 focus:ring-primary/35 resize-none"
                  placeholder="Type title or custom text..."
                />
              </div>

              <Button
                type="button"
                onClick={handleAddStaticText}
                disabled={!textContent.trim()}
                variant="secondary"
                className="w-full h-9"
                size="sm"
              >
                Add Static Text to Media Bin
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
