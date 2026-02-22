import {
  createProject,
  deleteProjectById,
  getLocalUserId,
  getProjectById,
  listProjectsByUser,
  renameProjectById,
} from "~/lib/projects.repo";
import {
  loadProjectState,
  type ProjectEditorState,
  saveProjectState,
} from "~/lib/timeline.store";
import type { MediaBinItem, TimelineState } from "~/components/timeline/types";
import type { ClipTranscriptsMap } from "~/components/media/captions.types";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const userId = getLocalUserId();

  if (pathname.endsWith("/api/projects") && request.method === "GET") {
    const rows = await listProjectsByUser(userId);
    return new Response(JSON.stringify({ projects: rows }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const match = pathname.match(/\/api\/projects\/([^/]+)$/);
  if (match && request.method === "GET") {
    const id = match[1];
    const project = await getProjectById(id);
    if (!project) {
      return new Response("Not Found", { status: 404 });
    }
    const state = await loadProjectState(id);
    return new Response(
      JSON.stringify({
        project,
        timeline: state.timeline,
        mediaBinItems: state.mediaBinItems,
        textBinItems: state.textBinItems,
        clipTranscripts: state.clipTranscripts,
        editorState: state.editorState,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return new Response("Not Found", { status: 404 });
}

export async function action({ request }: { request: Request }) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const userId = getLocalUserId();

  if (pathname.endsWith("/api/projects") && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || "Untitled Project").slice(0, 120);
    const project = await createProject({ userId, name });
    return new Response(JSON.stringify({ project }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }

  const match = pathname.match(/\/api\/projects\/([^/]+)$/);
  if (!match) {
    return new Response("Not Found", { status: 404 });
  }

  const id = match[1];
  const project = await getProjectById(id);
  if (!project || project.user_id !== userId) {
    return new Response("Not Found", { status: 404 });
  }

  if (request.method === "DELETE") {
    const ok = await deleteProjectById(id, userId);
    return new Response(JSON.stringify({ success: ok }), {
      status: ok ? 200 : 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (request.method === "PATCH") {
    const body = await request.json().catch(() => ({}));
    const name: string | undefined = body?.name
      ? String(body.name).slice(0, 120)
      : undefined;
    const timeline: TimelineState | undefined = body?.timeline;
    const mediaBinItems: MediaBinItem[] | undefined = Array.isArray(
      body?.mediaBinItems
    )
      ? body.mediaBinItems
      : undefined;
    const textBinItems: MediaBinItem[] | undefined = Array.isArray(
      body?.textBinItems
    )
      ? body.textBinItems
      : undefined;
    const clipTranscripts: ClipTranscriptsMap | undefined =
      body?.clipTranscripts &&
      typeof body.clipTranscripts === "object" &&
      !Array.isArray(body.clipTranscripts)
        ? (body.clipTranscripts as ClipTranscriptsMap)
        : undefined;
    const editorState: ProjectEditorState | undefined =
      body?.editorState &&
      typeof body.editorState === "object" &&
      !Array.isArray(body.editorState)
        ? {
            zoomLevel: Number((body.editorState as Record<string, unknown>).zoomLevel),
            timelineWidth: Number(
              (body.editorState as Record<string, unknown>).timelineWidth
            ),
          }
        : undefined;

    if (
      !name &&
      !timeline &&
      !mediaBinItems &&
      !textBinItems &&
      !clipTranscripts &&
      !editorState
    ) {
      return new Response(JSON.stringify({ error: "No changes" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (name) {
      const renamed = await renameProjectById(id, userId, name);
      if (!renamed) {
        return new Response("Not Found", { status: 404 });
      }
    }

    if (
      timeline ||
      mediaBinItems ||
      textBinItems ||
      clipTranscripts ||
      editorState
    ) {
      const prev = await loadProjectState(id);
      await saveProjectState(id, {
        timeline: timeline ?? prev.timeline,
        mediaBinItems:
          mediaBinItems ?? textBinItems ?? prev.mediaBinItems ?? prev.textBinItems,
        textBinItems: textBinItems ?? prev.textBinItems,
        clipTranscripts: clipTranscripts ?? prev.clipTranscripts,
        editorState: editorState ?? prev.editorState,
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method Not Allowed", { status: 405 });
}
