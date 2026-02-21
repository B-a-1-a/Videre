#!/usr/bin/env node
import { mkdir, rm, readdir, cp, chmod, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync, execSync } from "node:child_process";
import { platform } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const binariesDir = join(repoRoot, "src-tauri", "binaries");
const workDir = join(tmpdir(), `videre-sidecars-${Date.now()}`);

const allTargets = [
  {
    name: "macos-arm64",
    ffmpegUrl: "https://evermeet.cx/ffmpeg/getrelease/zip",
    ffprobeUrl: "https://evermeet.cx/ffprobe/getrelease/zip",
    ffmpegOut: "ffmpeg-aarch64-apple-darwin",
    ffprobeOut: "ffprobe-aarch64-apple-darwin",
    windows: false,
    platform: "darwin",
  },
  {
    name: "macos-x64",
    ffmpegUrl: "https://evermeet.cx/ffmpeg/getrelease/zip",
    ffprobeUrl: "https://evermeet.cx/ffprobe/getrelease/zip",
    ffmpegOut: "ffmpeg-x86_64-apple-darwin",
    ffprobeOut: "ffprobe-x86_64-apple-darwin",
    windows: false,
    platform: "darwin",
  },
  {
    name: "windows-x64",
    ffmpegUrl: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    ffprobeUrl: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    ffmpegOut: "ffmpeg-x86_64-pc-windows-msvc.exe",
    ffprobeOut: "ffprobe-x86_64-pc-windows-msvc.exe",
    windows: true,
    platform: "win32",
  },
];

// Only fetch sidecars for the current platform (avoids cross-platform zip issues)
const currentPlatform = platform();
const targets = allTargets.filter((t) => t.platform === currentPlatform);
if (targets.length === 0) {
  console.error(`No sidecar targets for platform: ${currentPlatform}`);
  process.exit(1);
}

async function downloadFile(url, dest) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed for ${url}: ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(dest, bytes);
}

function extractZip(zipPath, destDir) {
  if (platform() === "win32") {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`,
      { stdio: "inherit" }
    );
  } else {
    execFileSync("unzip", ["-o", zipPath, "-d", destDir], { stdio: "inherit" });
  }
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

    extractZip(ffmpegZip, extractDir);
    if (ffprobeZip !== ffmpegZip) {
      extractZip(ffprobeZip, extractDir);
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

  // On Windows ARM64 the bundler looks for aarch64-named sidecars; copy x64 binaries to those names
  if (currentPlatform === "win32") {
    const x64Ffmpeg = join(binariesDir, "ffmpeg-x86_64-pc-windows-msvc.exe");
    const x64Ffprobe = join(binariesDir, "ffprobe-x86_64-pc-windows-msvc.exe");
    const arm64Ffmpeg = join(binariesDir, "ffmpeg-aarch64-pc-windows-msvc.exe");
    const arm64Ffprobe = join(binariesDir, "ffprobe-aarch64-pc-windows-msvc.exe");
    try {
      await cp(x64Ffmpeg, arm64Ffmpeg, { force: true });
      await cp(x64Ffprobe, arm64Ffprobe, { force: true });
      console.log("Copied x64 sidecars to aarch64 names for bundler.");
    } catch {
      // x64 binaries not present, skip
    }
  }

  console.log(`Sidecars ready in ${binariesDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
