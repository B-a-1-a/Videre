import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { VideoElement, AudioElement, ImageElement } from "@twick/timeline";
import { useEditorStore } from "../../store/editorStore";

const VIDEO_RESOLUTION = { width: 1920, height: 1080 };

export function MediaBin() {
  const currentProject = useEditorStore((state) => state.currentProject);
  const assets = useEditorStore((state) => state.assets);
  const importProgressByAssetId = useEditorStore((state) => state.importProgressByAssetId);
  const twickAddElement = useEditorStore((state) => state.twickAddElement);

  const importMedia = useEditorStore((state) => state.importMedia);
  const removeAsset = useEditorStore((state) => state.removeAsset);

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
    if (!twickAddElement) return;

    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;

    // Prefer proxy (lower bitrate) for preview, fall back to original
    const sourcePath = asset.proxyPath ?? asset.managedPath;
    const url = convertFileSrc(sourcePath);

    let element: VideoElement | AudioElement | ImageElement;
    if (assetKind === "video") {
      element = new VideoElement(url, VIDEO_RESOLUTION);
      if (asset.durationMs) element.setMediaDuration(asset.durationMs / 1000);
    } else if (assetKind === "audio") {
      element = new AudioElement(url);
      if (asset.durationMs) element.setMediaDuration(asset.durationMs / 1000);
    } else {
      element = new ImageElement(url, VIDEO_RESOLUTION);
    }

    await twickAddElement(element);
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
