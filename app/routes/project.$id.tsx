import { useParams, useNavigate, useLoaderData, type LoaderFunctionArgs } from "react-router";
import React, { useEffect } from "react";
import TimelineEditor from "./home";
import { loadTimeline } from "~/lib/timeline.store";
import type { TimelineState } from "~/components/timeline/types";

export async function loader({ params }: LoaderFunctionArgs) {
  // Prefetch timeline to hydrate faster in local mode.
  const id = params.id as string;
  const timeline = await loadTimeline(id);
  return { timeline };
}

export default function ProjectEditorRoute() {
  const params = useParams();
  const navigate = useNavigate();
  const id = params.id as string;
  const data = useLoaderData() as { timeline?: TimelineState };

  useEffect(() => {
    // Lightweight guard: verify project exists before showing editor.
    (async () => {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
      if (!res.ok) navigate("/projects");
    })();
  }, [id, navigate]);

  // Pass through existing editor; it manages state internally. We injected loader for prefetch.
  return <TimelineEditor />;
}
