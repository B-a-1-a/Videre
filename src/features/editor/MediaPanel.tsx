import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "../../store/editorStore";
import type { AssetKind, MediaAsset } from "../../types/domain";

type KindFilter = "all" | AssetKind;
type SortMode = "recent" | "name" | "duration";

function AudioPreview({ asset }: { asset: MediaAsset }) {
  if (asset.kind !== "audio") return null;
  const sourcePath = asset.proxyPath ?? asset.managedPath;
  if (!sourcePath) return null;
  return (
    <audio
      className="asset-audio-preview"
      controls
      preload="metadata"
      src={convertFileSrc(sourcePath)}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    />
  );
}

export function MediaPanel() {
  const assets = useEditorStore((s) => s.assets);
  const loading = useEditorStore((s) => s.loading);
  const importProgressByAssetId = useEditorStore((s) => s.importProgressByAssetId);
  const importMedia = useEditorStore((s) => s.importMedia);
  const removeAsset = useEditorStore((s) => s.removeAsset);
  const addClipFromAsset = useEditorStore((s) => s.addClipFromAsset);
  const timeline = useEditorStore((s) => s.timeline);
  const selectedTrackId = useEditorStore((s) => s.selectedTrackId);
  const playheadMs = useEditorStore((s) => s.playheadMs);

  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("recent");

  async function handleImport() {
    const filePaths = await open({
      multiple: true,
      title: "Import media",
      filters: [
        {
          name: "Media",
          extensions: ["mp4", "mov", "mkv", "mp3", "wav", "aac", "flac", "png", "jpg", "jpeg", "webp"],
        },
      ],
    });
    if (!filePaths) return;
    const normalized = Array.isArray(filePaths) ? filePaths : [filePaths];
    await importMedia(normalized);
  }

  function handleAddToTimeline(assetId: string, assetKind: AssetKind) {
    if (!timeline) return;
    // Pick the selected track, or auto-find a matching one
    let trackId = selectedTrackId;
    if (!trackId) {
      const matchKind = assetKind === "audio" ? "audio" : "video";
      const track = timeline.tracks.find((t) => t.kind === matchKind);
      trackId = track?.id;
    }
    if (!trackId) return;
    void addClipFromAsset(assetId, trackId, playheadMs);
  }

  function handleAssetDragStart(event: React.DragEvent<HTMLDivElement>, asset: MediaAsset) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      "application/x-videre-asset",
      JSON.stringify({ assetId: asset.id, assetKind: asset.kind }),
    );
  }

  const filteredAssets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const next = assets.filter((asset) => {
      const matchesKind = kindFilter === "all" || asset.kind === kindFilter;
      const matchesQuery = !query || asset.fileName.toLowerCase().includes(query);
      return matchesKind && matchesQuery;
    });

    if (sortMode === "name") {
      next.sort((a, b) => a.fileName.localeCompare(b.fileName));
    } else if (sortMode === "duration") {
      next.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
    }
    return next;
  }, [assets, kindFilter, searchQuery, sortMode]);

  return (
    <div className="media-panel">
      <div className="media-panel-header">
        <span>Media ({filteredAssets.length})</span>
      </div>
      <button
        className="assets-import-btn"
        disabled={loading}
        onClick={() => void handleImport()}
        type="button"
      >
        + Import Media
      </button>

      <div className="media-panel-controls">
        <input
          className="media-search-input"
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
          placeholder="Search assets"
          type="text"
          value={searchQuery}
        />
        <div className="media-filter-row">
          <select value={kindFilter} onChange={(event) => setKindFilter(event.currentTarget.value as KindFilter)}>
            <option value="all">All</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
            <option value="image">Image</option>
          </select>
          <select value={sortMode} onChange={(event) => setSortMode(event.currentTarget.value as SortMode)}>
            <option value="recent">Recent</option>
            <option value="name">Name</option>
            <option value="duration">Duration</option>
          </select>
        </div>
      </div>

      <div className="media-panel-list">
        {filteredAssets.length === 0 ? (
          <div className="assets-empty">No assets imported yet.</div>
        ) : (
          filteredAssets.map((asset) => {
            const progress = importProgressByAssetId[asset.id];
            const dur = asset.durationMs ? `${(asset.durationMs / 1000).toFixed(1)}s` : "—";
            return (
              <div
                className="asset-row"
                draggable
                key={asset.id}
                onDoubleClick={() => handleAddToTimeline(asset.id, asset.kind)}
                onDragStart={(event) => handleAssetDragStart(event, asset)}
              >
                <div className="asset-info">
                  <div className="asset-filename">{asset.fileName}</div>
                  <div className="asset-details">
                    <span className={`asset-kind-tag kind-${asset.kind}`}>{asset.kind}</span>
                    <span>· {dur}</span>
                  </div>
                  {typeof progress === "number" && progress < 1 && (
                    <div className="asset-progress-bar">
                      <div className="asset-progress-fill" style={{ width: `${progress * 100}%` }} />
                    </div>
                  )}
                  <AudioPreview asset={asset} />
                </div>
                <div className="asset-btns">
                  <button onClick={() => handleAddToTimeline(asset.id, asset.kind)} type="button">
                    Add
                  </button>
                  <button className="btn-danger" onClick={() => void removeAsset(asset.id)} type="button">
                    ×
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
