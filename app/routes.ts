import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  route("/", "routes/index.tsx"),
  route("/projects", "routes/projects.tsx"),
  route("/profile", "routes/profile.tsx"),
  route("/project/:id", "routes/project.$id.tsx", [
    index("components/timeline/MediaBin.tsx"),
    route("text-editor", "components/media/TextEditor.tsx"),
    route("media-bin", "components/timeline/MediaBinPage.tsx"),
    route("transitions", "components/media/Transitions.tsx"),
    route("captions", "components/media/Captions.tsx"),
  ]),
  route("/api/projects/*", "routes/api.projects.$.tsx"),
  route("/api/storage/*", "routes/api.storage.$.tsx"),
  route("*", "./NotFound.tsx"),
] satisfies RouteConfig;
