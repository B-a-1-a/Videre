import { createBrowserRouter } from "react-router-dom";
import { AppFrame } from "./AppFrame";
import { LandingRoute } from "./routes/landing";
import { NotFoundRoute } from "./routes/not-found";
import { ProfileRoute } from "./routes/profile";
import { ProjectRoute } from "./routes/project";
import { ProjectsRoute } from "./routes/projects";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppFrame />,
    children: [
      { index: true, element: <LandingRoute /> },
      { path: "projects", element: <ProjectsRoute /> },
      { path: "project/:id/*", element: <ProjectRoute /> },
      { path: "profile", element: <ProfileRoute /> },
      { path: "*", element: <NotFoundRoute /> },
    ],
  },
]);
