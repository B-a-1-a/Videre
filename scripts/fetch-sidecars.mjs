#!/usr/bin/env node
import {
  mkdir,
  rm,
  readdir,
  chmod,
  writeFile,
  copyFile,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const binariesDir = join(repoRoot, "src-tauri", "binaries");
const workDir = join(tmpdir(), `videre-sidecars-${Date.now()}`);

const targets = [
  {
    name: "macos-arm64",
    ffmpegUrl: "https://evermeet.cx/ffmpeg/getrelease/zip",
    ffprobeUrl: "https://evermeet.cx/ffprobe/getrelease/zip",
    ffmpegOut: "ffmpeg-aarch64-apple-darwin",
    ffprobeOut: "ffprobe-aarch64-apple-darwin",
    windows: false,
  },
  {
    name: "macos-x64",
    ffmpegUrl: "https://evermeet.cx/ffmpeg/getrelease/zip",
    ffprobeUrl: "https://evermeet.cx/ffprobe/getrelease/zip",
    ffmpegOut: "ffmpeg-x86_64-apple-darwin",
    ffprobeOut: "ffprobe-x86_64-apple-darwin",
    windows: false,
  },
  {
    name: "windows-x64",
    ffmpegUrl: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    ffprobeUrl: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    ffmpegOut: "ffmpeg-x86_64-pc-windows-msvc.exe",
    ffprobeOut: "ffprobe-x86_64-pc-windows-msvc.exe",
    windows: true,
  },
];

function selectedTargets() {
  const all = process.argv.includes("--all");
  if (all) {
    return targets;
  }

  if (process.platform === "darwin" && process.arch === "arm64") {
    return targets.filter((target) => target.name === "macos-arm64");
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return targets.filter((target) => target.name === "macos-x64");
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return targets.filter((target) => target.name === "windows-x64");
  }

  // For uncommon host targets, try fetching all known targets.
  return targets;
}

async function downloadFile(url, dest) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed for ${url}: ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(dest, bytes);
}

async function findFileRecursively(dir, filename) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFileRecursively(fullPath, filename);
      if (nested) return nested;
      continue;
    }

    if (entry.name.toLowerCase() === filename.toLowerCase()) {
      return fullPath;
    }
  }
  return null;
}

function resolveLocalBinary(name) {
  try {
    return execFileSync("which", [name], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function copyBinary(src, dest) {
  // Remove stale files/symlinks so repeated runs stay idempotent.
  await rm(dest, { force: true });
  const resolvedSrc = await realpath(src).catch(() => src);
  await copyFile(resolvedSrc, dest);
}

async function main() {
  await mkdir(binariesDir, { recursive: true });
  await rm(workDir, { force: true, recursive: true });
  await mkdir(workDir, { recursive: true });

  for (const target of selectedTargets()) {
    console.log(`Fetching sidecars for ${target.name}...`);
    const targetDir = join(workDir, target.name);
    await mkdir(targetDir, { recursive: true });

    const ffmpegZip = join(targetDir, "ffmpeg.zip");
    const ffprobeZip = join(
      targetDir,
      target.ffprobeUrl === target.ffmpegUrl ? "ffmpeg.zip" : "ffprobe.zip",
    );

    const extractDir = join(targetDir, "extract");
    await mkdir(extractDir, { recursive: true });
    let downloaded = false;

    try {
      await downloadFile(target.ffmpegUrl, ffmpegZip);
      if (ffprobeZip !== ffmpegZip) {
        await downloadFile(target.ffprobeUrl, ffprobeZip);
      }

      execFileSync("unzip", ["-o", ffmpegZip, "-d", extractDir], { stdio: "inherit" });
      if (ffprobeZip !== ffmpegZip) {
        execFileSync("unzip", ["-o", ffprobeZip, "-d", extractDir], { stdio: "inherit" });
      }
      downloaded = true;
    } catch (error) {
      if (target.windows) {
        throw error;
      }
      console.warn(
        `Download/extract failed for ${target.name}, falling back to local binaries when available.`,
      );
    }

    let ffmpegSource = downloaded
      ? await findFileRecursively(extractDir, target.windows ? "ffmpeg.exe" : "ffmpeg")
      : null;
    let ffprobeSource = downloaded
      ? await findFileRecursively(extractDir, target.windows ? "ffprobe.exe" : "ffprobe")
      : null;

    if (!target.windows) {
      ffmpegSource ??= resolveLocalBinary("ffmpeg");
      ffprobeSource ??= resolveLocalBinary("ffprobe");
    }

    if (!ffmpegSource || !ffprobeSource) {
      throw new Error(
        `Failed to locate ffmpeg/ffprobe binaries for ${target.name} (ffmpeg: ${Boolean(ffmpegSource)}, ffprobe: ${Boolean(ffprobeSource)})`,
      );
    }

    const ffmpegDest = join(binariesDir, target.ffmpegOut);
    const ffprobeDest = join(binariesDir, target.ffprobeOut);

    await copyBinary(ffmpegSource, ffmpegDest);
    await copyBinary(ffprobeSource, ffprobeDest);

    if (!target.windows) {
      await chmod(ffmpegDest, 0o755);
      await chmod(ffprobeDest, 0o755);
    }
  }

  console.log(`Sidecars ready in ${binariesDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
