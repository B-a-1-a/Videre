import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search, Image as ImageIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import { Separator } from "~/components/ui/separator";
import type { ClipTranscriptsMap } from "~/components/media/captions.types";

const API_BASE = "http://localhost:8000";
function apiUrl(path: string) {
    return `${API_BASE}${path}`;
}

type RetrievalResult = {
    filename: string;
    score: number;
    url: string;
};

interface RetrievalPanelProps {
    clipTranscripts: ClipTranscriptsMap;
}

export function RetrievalPanel({ clipTranscripts }: RetrievalPanelProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [results, setResults] = useState<RetrievalResult[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [lastQuery, setLastQuery] = useState("");
    const [autoTriggered, setAutoTriggered] = useState(false);

    const fetchRetrieval = useCallback(async (query: string) => {
        if (!query.trim()) return;
        try {
            setIsLoading(true);
            setLastQuery(query.trim());
            const response = await fetch(apiUrl("/retrieve-media"), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: query.trim(), topK: 6 }),
            });
            if (!response.ok) return;
            const payload = await response.json();
            if (payload.results && payload.results.length > 0) {
                setResults(payload.results);
            } else {
                setResults([]);
            }
        } catch (err) {
            console.warn("Retrieval failed:", err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Auto-trigger from transcript text
    useEffect(() => {
        if (autoTriggered) return;
        const transcriptTexts = Object.values(clipTranscripts)
            .filter((r) => r.text && !r.error)
            .map((r) => r.text)
            .join(" ")
            .trim();
        if (transcriptTexts) {
            setAutoTriggered(true);
            setSearchQuery(transcriptTexts.slice(0, 200));
            fetchRetrieval(transcriptTexts.slice(0, 200));
        }
    }, [clipTranscripts, autoTriggered, fetchRetrieval]);

    const handleSearch = useCallback(() => {
        fetchRetrieval(searchQuery);
    }, [fetchRetrieval, searchQuery]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault();
                handleSearch();
            }
        },
        [handleSearch]
    );

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2 mb-1">
                    <Search className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">Media Retrieval</h2>
                </div>
                <p className="text-[10px] text-muted-foreground">
                    Search for related images & videos using AI
                </p>
            </div>

            {/* Search Bar */}
            <div className="px-4 py-3">
                <div className="flex gap-2">
                    <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type a query or use transcript..."
                        className="h-8 text-xs flex-1"
                    />
                    <Button
                        variant="default"
                        size="sm"
                        className="h-8 px-3"
                        disabled={isLoading || !searchQuery.trim()}
                        onClick={handleSearch}
                    >
                        {isLoading ? (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Search className="h-3.5 w-3.5" />
                        )}
                    </Button>
                </div>
                {lastQuery && (
                    <p className="text-[9px] text-muted-foreground mt-1.5 truncate">
                        Last query: &quot;{lastQuery.slice(0, 80)}
                        {lastQuery.length > 80 ? "..." : ""}&quot;
                    </p>
                )}
            </div>

            <Separator />

            {/* Results */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
                {isLoading && results.length === 0 && (
                    <div className="flex flex-col items-center justify-center gap-3 py-12">
                        <RefreshCw className="h-6 w-6 animate-spin text-primary/60" />
                        <div className="text-center">
                            <p className="text-xs text-muted-foreground font-medium">
                                Finding related media...
                            </p>
                            <p className="text-[10px] text-muted-foreground/70 mt-1">
                                Loading AI model & computing similarity
                            </p>
                        </div>
                    </div>
                )}

                {!isLoading && results.length === 0 && !lastQuery && (
                    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                        <div className="rounded-full bg-muted/50 p-4">
                            <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground font-medium">
                                No results yet
                            </p>
                            <p className="text-[10px] text-muted-foreground/70 mt-1">
                                Transcribe a clip or type a search query
                            </p>
                        </div>
                    </div>
                )}

                {!isLoading && results.length === 0 && lastQuery && (
                    <div className="text-center py-8">
                        <p className="text-xs text-muted-foreground">
                            No matches found for this query
                        </p>
                    </div>
                )}

                {results.length > 0 && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] font-medium text-muted-foreground">
                                {results.length} result{results.length !== 1 ? "s" : ""} found
                            </p>
                            {isLoading && (
                                <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                            {results.map((item, idx) => {
                                const isVideo =
                                    item.filename.includes(".mp4") ||
                                    item.filename.includes(".webm") ||
                                    item.filename.includes(".mov");
                                const baseUrl = apiUrl(item.url);
                                const displayName = item.filename.split("/").pop() || item.filename;
                                const scorePercent = (item.score * 100).toFixed(0);

                                return (
                                    <div
                                        key={idx}
                                        className="group relative rounded-lg overflow-hidden border border-border/50 bg-card hover:border-primary/40 transition-colors cursor-grab active:cursor-grabbing"
                                        draggable
                                        onDragStart={(e) => {
                                            const item = {
                                                id: `retrieved-${Date.now()}-${idx}`,
                                                name: displayName,
                                                mediaType: isVideo ? "video" : "image",
                                                mediaUrlLocal: baseUrl,
                                                mediaUrlRemote: baseUrl,
                                                durationInSeconds: 5, // default duration
                                                media_width: 1920,
                                                media_height: 1080,
                                            };
                                            e.dataTransfer.setData("application/json", JSON.stringify(item));
                                        }}
                                    >
                                        {isVideo ? (
                                            <video
                                                src={baseUrl}
                                                className="w-full h-24 object-cover"
                                                muted
                                                preload="metadata"
                                            />
                                        ) : (
                                            <img
                                                src={baseUrl}
                                                alt={displayName}
                                                className="w-full h-24 object-cover"
                                            />
                                        )}
                                        <div className="absolute top-1.5 right-1.5">
                                            <Badge
                                                variant="secondary"
                                                className="h-4 px-1.5 text-[9px] font-mono bg-black/60 text-white border-0"
                                            >
                                                {scorePercent}%
                                            </Badge>
                                        </div>
                                        <div className="px-2 py-1.5 bg-card">
                                            <p className="text-[9px] text-muted-foreground font-mono truncate">
                                                {displayName}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
