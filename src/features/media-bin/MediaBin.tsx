import { open } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "../../store/editorStore";

export function MediaBin() {
  const currentProject = useEditorStore((state) => state.currentProject);
  const assets = useEditorStore((state) => state.assets);
  const timeline = useEditorStore((state) => state.timeline);
  const playheadMs = useEditorStore((state) => state.playheadMs);
  const selectedTrackId = useEditorStore((state) => state.selectedTrackId);
  const importProgressByAssetId = useEditorStore((state) => state.importProgressByAssetId);

  const importMedia = useEditorStore((state) => state.importMedia);
  const removeAsset = useEditorStore((state) => state.removeAsset);
  const addClipFromAsset = useEditorStore((state) => state.addClipFromAsset);

  async function handleImport() {
    const filePaths = await open({
      multiple: true,
      title: "Import media",
      filters: [{ name: "Media", extensions: ["mp4", "mov", "mkv", "mp3", "wav", "aac", "flac", "png", "jpg", "jpeg", "webp"] }],
    });

    if (!filePaths) return;
    const normalized = Array.isArray(filePaths) ? filePaths : [filePaths];
    await importMedia(normalized);
  }

  async function handleAddToTimeline(assetId: string, assetKind: string) {
    if (!timeline) return;

    const fallbackTrack =
      timeline.tracks.find((track) =>
        assetKind === "audio" ? track.kind === "audio" : track.kind === "video",
      ) ?? timeline.tracks[0];

    const trackId = selectedTrackId ?? fallbackTrack?.id;
    if (!trackId) return;

    await addClipFromAsset(assetId, trackId, playheadMs);
  }

  return (
    <section className="panel">
      <header className="panel-header panel-header-row">
        <h2>Media Bin</h2>
        <button disabled={!currentProject} onClick={() => void handleImport()} type="button">
          Import
        </button>
      </header>

      {!currentProject && <div className="muted">Open a project to import media.</div>}

      <div className="asset-list">
        {assets.map((asset) => {
          const durationSeconds = asset.durationMs ? (asset.durationMs / 1000).toFixed(2) : "--";
          const progress = importProgressByAssetId[asset.id];
          return (
            <div className="asset-item" key={asset.id}>
              <div className="asset-main">
                <div className="asset-name">{asset.fileName}</div>
                <div className="asset-meta">
                  <span>{asset.kind}</span>
                  <span>{durationSeconds}s</span>
                  <span>{asset.status}</span>
                </div>
                {typeof progress === "number" && progress < 1 && (
                  <div className="asset-progress">Processing {(progress * 100).toFixed(0)}%</div>
                )}
              </div>
              <div className="button-row">
                <button onClick={() => void handleAddToTimeline(asset.id, asset.kind)} type="button">
                  Add
                </button>
                <button onClick={() => void removeAsset(asset.id)} type="button">
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
