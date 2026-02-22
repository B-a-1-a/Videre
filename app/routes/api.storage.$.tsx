import {
  getDirectorySizeBytes,
  MEDIA_DIR,
  PROJECT_STATE_DIR,
  STORAGE_LIMIT_BYTES,
} from "~/lib/local-storage";

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname.endsWith("/api/storage") && request.method === "GET") {
    const mediaBytes = getDirectorySizeBytes(MEDIA_DIR);
    const stateBytes = getDirectorySizeBytes(PROJECT_STATE_DIR);
    const usedBytes = mediaBytes + stateBytes;
    return new Response(
      JSON.stringify({
        usedBytes,
        limitBytes: STORAGE_LIMIT_BYTES,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
  return new Response("Not Found", { status: 404 });
}

export async function action() {
  return new Response("Method Not Allowed", { status: 405 });
}
