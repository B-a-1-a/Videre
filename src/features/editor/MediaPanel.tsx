import { open } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "../../store/editorStore";

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

  function handleAddToTimeline(assetId: string, assetKind: string) {
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

  return (
    <div className="media-panel">
      <div className="media-panel-header">
        <span>Media</span>
      </div>
      <button
        className="assets-import-btn"
        disabled={loading}
        onClick={() => void handleImport()}
        type="button"
      >
        + Import Media
      </button>
      <div className="media-panel-list">
        {assets.length === 0 ? (
          <div className="assets-empty">No assets imported yet.</div>
        ) : (
          assets.map((asset) => {
            const progress = importProgressByAssetId[asset.id];
            const dur = asset.durationMs ? `${(asset.durationMs / 1000).toFixed(1)}s` : "—";
            return (
              <div className="asset-row" key={asset.id}>
                <div className="asset-info">
                  <div className="asset-filename">{asset.fileName}</div>
                  <div className="asset-details">
                    {asset.kind} · {dur}
                  </div>
                  {typeof progress === "number" && progress < 1 && (
                    <div className="asset-progress-bar">
                      <div className="asset-progress-fill" style={{ width: `${progress * 100}%` }} />
                    </div>
                  )}
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
