#!/usr/bin/env node
import { mkdir, rm, readdir, cp, chmod, writeFile } from "node:fs/promises";
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

async function main() {
  await mkdir(binariesDir, { recursive: true });
  await rm(workDir, { force: true, recursive: true });
  await mkdir(workDir, { recursive: true });

  for (const target of targets) {
    console.log(`Fetching sidecars for ${target.name}...`);
    const targetDir = join(workDir, target.name);
    await mkdir(targetDir, { recursive: true });

    const ffmpegZip = join(targetDir, "ffmpeg.zip");
    const ffprobeZip = join(
      targetDir,
      target.ffprobeUrl === target.ffmpegUrl ? "ffmpeg.zip" : "ffprobe.zip",
    );

    await downloadFile(target.ffmpegUrl, ffmpegZip);
    await downloadFile(target.ffprobeUrl, ffprobeZip);

    const extractDir = join(targetDir, "extract");
    await mkdir(extractDir, { recursive: true });

    execFileSync("unzip", ["-o", ffmpegZip, "-d", extractDir], { stdio: "inherit" });
    if (ffprobeZip !== ffmpegZip) {
      execFileSync("unzip", ["-o", ffprobeZip, "-d", extractDir], { stdio: "inherit" });
    }

    const ffmpegSource = await findFileRecursively(extractDir, target.windows ? "ffmpeg.exe" : "ffmpeg");
    const ffprobeSource = await findFileRecursively(extractDir, target.windows ? "ffprobe.exe" : "ffprobe");

    if (!ffmpegSource || !ffprobeSource) {
      throw new Error(`Failed to locate ffmpeg/ffprobe binaries for ${target.name}`);
    }

    const ffmpegDest = join(binariesDir, target.ffmpegOut);
    const ffprobeDest = join(binariesDir, target.ffprobeOut);

    await cp(ffmpegSource, ffmpegDest, { force: true });
    await cp(ffprobeSource, ffprobeDest, { force: true });

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
