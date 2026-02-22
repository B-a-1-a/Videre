import fs from "fs";
import path from "path";

export const DATA_ROOT = path.resolve(
  process.env.VIDERE_DATA_DIR || "local_data"
);
export const PROJECTS_FILE = path.join(DATA_ROOT, "projects.json");
export const PROJECT_STATE_DIR = path.join(DATA_ROOT, "project_state");
export const MEDIA_DIR = path.resolve(
  process.env.VIDERE_MEDIA_DIR || "out"
);
export const STORAGE_LIMIT_BYTES =
  Number(process.env.VIDERE_STORAGE_LIMIT_BYTES) || 50 * 1024 * 1024 * 1024;

export function ensureLocalStorageDirs(): void {
  for (const dir of [DATA_ROOT, PROJECT_STATE_DIR, MEDIA_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filePath: string, data: unknown): void {
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export function sanitizeId(raw: string): string {
  const value = String(raw || "");
  const clean = value.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!clean) {
    throw new Error("Invalid identifier");
  }
  return clean;
}

export function getDirectorySizeBytes(targetDir: string): number {
  if (!fs.existsSync(targetDir)) return 0;

  let total = 0;
  const stack = [targetDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        total += fs.statSync(fullPath).size;
      }
    }
  }
  return total;
}
