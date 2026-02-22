import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  ensureProjectMediaDir,
  ensureLocalStorageDirs,
  PROJECT_STATE_DIR,
  PROJECTS_FILE,
  readJsonFile,
  removeProjectMediaDir,
  sanitizeId,
  writeJsonFile,
} from "~/lib/local-storage";

export type ProjectRecord = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type ProjectsFile = {
  projects: ProjectRecord[];
};

const LOCAL_USER_ID = "local-user";

function loadProjects(): ProjectRecord[] {
  ensureLocalStorageDirs();
  const parsed = readJsonFile<ProjectsFile>(PROJECTS_FILE, { projects: [] });
  return Array.isArray(parsed.projects) ? parsed.projects : [];
}

function saveProjects(projects: ProjectRecord[]): void {
  writeJsonFile(PROJECTS_FILE, { projects });
}

export async function createProject(params: {
  userId: string;
  name: string;
}): Promise<ProjectRecord> {
  const now = new Date().toISOString();
  const next: ProjectRecord = {
    id: crypto.randomUUID(),
    user_id: params.userId || LOCAL_USER_ID,
    name: String(params.name || "Untitled Project").slice(0, 120),
    created_at: now,
    updated_at: now,
  };
  ensureProjectMediaDir(next.id);
  const projects = loadProjects();
  projects.push(next);
  saveProjects(projects);
  return next;
}

export async function listProjectsByUser(
  userId: string
): Promise<ProjectRecord[]> {
  return loadProjects()
    .filter((project) => project.user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getProjectById(
  id: string
): Promise<ProjectRecord | null> {
  const projectId = sanitizeId(id);
  return loadProjects().find((project) => project.id === projectId) ?? null;
}

export async function renameProjectById(
  id: string,
  userId: string,
  name: string
): Promise<boolean> {
  const projectId = sanitizeId(id);
  const projects = loadProjects();
  const index = projects.findIndex(
    (project) => project.id === projectId && project.user_id === userId
  );
  if (index < 0) return false;
  projects[index] = {
    ...projects[index],
    name: String(name || "Untitled Project").slice(0, 120),
    updated_at: new Date().toISOString(),
  };
  saveProjects(projects);
  return true;
}

export async function deleteProjectById(
  id: string,
  userId: string
): Promise<boolean> {
  const projectId = sanitizeId(id);
  const projects = loadProjects();
  const next = projects.filter(
    (project) => !(project.id === projectId && project.user_id === userId)
  );
  if (next.length === projects.length) return false;
  saveProjects(next);

  // Best-effort cleanup of project state
  const stateFile = path.resolve(
    process.env.TIMELINE_DIR || PROJECT_STATE_DIR,
    `${projectId}.json`
  );
  try {
    fs.unlinkSync(stateFile);
  } catch {
    // ignore missing file
  }
  try {
    removeProjectMediaDir(projectId);
  } catch {
    // ignore filesystem cleanup failures
  }
  return true;
}

export function getLocalUserId(): string {
  return LOCAL_USER_ID;
}
