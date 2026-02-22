import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import multer from 'multer';
import { spawn, spawnSync } from 'child_process';

// The composition you want to render
const compositionId = 'TimelineComposition';
const OUT_DIR = path.resolve(process.env.VIDERE_MEDIA_DIR || 'out');
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const FPS = 30;
const DEFAULT_WHISPER_MODEL =
  process.env.VIDERE_WHISPER_MODEL || 'openai/whisper-small';
const DEFAULT_WHISPER_TIMESTAMPS = 'word';
const DEFAULT_WHISPER_COMPUTE_TYPE =
  process.env.VIDERE_WHISPER_COMPUTE_TYPE || 'int8';
const DEFAULT_WHISPER_CHUNK_SECONDS = (() => {
  const parsed = Number(process.env.VIDERE_WHISPER_CHUNK_SECONDS);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.max(parsed, 5), 600);
  }
  return 45;
})();
const WHISPER_SCRIPT_PATH_NPU = path.resolve(
  './app/videorender/whisper_npu_transcribe.py'
);
const WHISPER_SCRIPT_PATH_LEGACY = path.resolve(
  './app/videorender/whisper_transcribe.py'
);
const WHISPER_REQUIREMENTS_PATH = path.resolve(
  './app/videorender/requirements-whisper.txt'
);
const WHISPER_SETUP_HINT =
  `Install local deps with Python 3.12 in the project root:\n` +
  `python3.12 -m venv .venv-whisper\n` +
  `.venv-whisper/bin/pip install -r ${WHISPER_REQUIREMENTS_PATH}\n` +
  `Or set VIDERE_WHISPER_PYTHON to a Python interpreter that has faster-whisper (or torch + transformers).`;
const WHISPER_NPU_SETUP_HINT =
  `Install NPU deps from repo root: pip install -e ./nexa-caption-lab[npu]\n` +
  `Requires: onnxruntime-qnn, transformers. Or set VIDERE_WHISPER_PYTHON to a Python with nexa-caption-lab[npu].`;
let isTranscriptionRunning = false;
let cachedWhisperPythonLegacy: string | null = null;
let cachedWhisperPythonNpu: string | null = null;

type TranscriptMediaType =
  | 'video'
  | 'audio'
  | 'image'
  | 'text'
  | 'groupped_scrubber';

type WhisperClipJob = {
  scrubberId: string;
  inputPath: string;
  startSec: number;
  endSec: number;
};

type TranscribeClipWord = {
  text: string;
  start: number;
  end: number;
};

type TranscribeClipResult = {
  scrubberId: string;
  text: string;
  words: TranscribeClipWord[];
  clipStartSec: number;
  clipEndSec: number;
  error: string | null;
};

function ensureMediaRootDir(): void {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
}

function toSingleString(value: unknown): string | null {
  if (Array.isArray(value)) {
    return toSingleString(value[0]);
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function normalizeProjectId(value: unknown): string | null {
  const raw = toSingleString(value)?.trim() ?? '';
  if (!raw) return null;
  if (!PROJECT_ID_PATTERN.test(raw)) return null;
  return raw;
}

function getProjectIdFromRequest(req: Request): string | null {
  const fromQuery = normalizeProjectId(req.query.projectId);
  if (fromQuery) return fromQuery;

  if (req.body && typeof req.body === 'object') {
    const fromBody = normalizeProjectId(
      (req.body as Record<string, unknown>).projectId
    );
    if (fromBody) return fromBody;
  }
  return null;
}

function ensureProjectMediaDir(projectId: string): string {
  ensureMediaRootDir();
  const projectDir = path.resolve(OUT_DIR, projectId);
  if (!projectDir.startsWith(path.resolve(OUT_DIR))) {
    throw new Error('Invalid project directory path');
  }
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  return projectDir;
}

function normalizeStorageKeyToFsPath(storageKey: string): string {
  const trimmed = String(storageKey || '').trim();
  if (!trimmed) {
    throw new Error('Invalid media storage key');
  }
  return trimmed
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
    .join(path.sep);
}

function resolveStoragePath(storageKey: string): string {
  const filePath = path.resolve(OUT_DIR, normalizeStorageKeyToFsPath(storageKey));
  if (!filePath.startsWith(path.resolve(OUT_DIR))) {
    throw new Error('Access denied');
  }
  return filePath;
}

function getStorageKeyFromAbsolutePath(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  const base = path.resolve(OUT_DIR);
  if (!absolutePath.startsWith(base)) {
    throw new Error('Access denied');
  }
  return path.relative(base, absolutePath).split(path.sep).join('/');
}

function toMediaUrl(storageKey: string): string {
  const encodedKey = storageKey
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/media/${encodedKey}`;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toNonNegativeInteger(value: unknown): number {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return 0;
  return Math.max(0, Math.floor(parsed));
}

function toMediaType(value: unknown): TranscriptMediaType | null {
  const raw = toSingleString(value)?.trim();
  if (
    raw === 'video' ||
    raw === 'audio' ||
    raw === 'image' ||
    raw === 'text' ||
    raw === 'groupped_scrubber'
  ) {
    return raw;
  }
  return null;
}

function normalizeWords(value: unknown): TranscribeClipWord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((word): TranscribeClipWord | null => {
      if (!word || typeof word !== 'object') return null;
      const node = word as Record<string, unknown>;
      const text = toSingleString(node.text)?.trim();
      const start = toFiniteNumber(node.start);
      const end = toFiniteNumber(node.end);
      if (!text || start === null || end === null) return null;
      return { text, start, end };
    })
    .filter((word): word is TranscribeClipWord => Boolean(word));
}

function normalizeWhisperPythonCandidate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes(path.sep) || trimmed.startsWith('.')) {
    return path.resolve(trimmed);
  }
  return trimmed;
}

function canProbeWhisperPython(pythonBin: string): { ok: boolean; reason?: string } {
  const probe = spawnSync(
    pythonBin,
    [
      '-c',
      [
        'import importlib.util as u, sys',
        'has_fw = u.find_spec("faster_whisper") is not None',
        'has_tf = u.find_spec("torch") is not None and u.find_spec("transformers") is not None',
        'sys.exit(0 if (has_fw or has_tf) else 1)',
      ].join('; '),
    ],
    {
      encoding: 'utf8',
      timeout: 20_000,
      env: process.env,
    }
  );

  if (probe.error) {
    return { ok: false, reason: probe.error.message };
  }
  if (probe.status !== 0) {
    const stderr = (probe.stderr || '').trim();
    const stdout = (probe.stdout || '').trim();
    const detail = stderr || stdout || `exit code ${probe.status}`;
    return { ok: false, reason: detail };
  }
  return { ok: true };
}

function canProbeNpuPython(pythonBin: string): { ok: boolean; reason?: string } {
  const probe = spawnSync(
    pythonBin,
    ['-c', 'import onnxruntime; from nexa_caption_lab.whisper_npu import transcribe_with_npu'],
    {
      encoding: 'utf8',
      timeout: 20_000,
      env: process.env,
    }
  );

  if (probe.error) {
    return { ok: false, reason: probe.error.message };
  }
  if (probe.status !== 0) {
    const stderr = (probe.stderr || '').trim();
    const stdout = (probe.stdout || '').trim();
    const detail = stderr || stdout || `exit code ${probe.status}`;
    return { ok: false, reason: detail };
  }
  return { ok: true };
}

function resolveWhisperPython(useLegacyWhisper: boolean): string {
  const forcedPython = (process.env.VIDERE_WHISPER_PYTHON || '').trim();
  const probeLegacy = (bin: string) => canProbeWhisperPython(bin);
  const probeNpu = (bin: string) => canProbeNpuPython(bin);
  const probe = useLegacyWhisper ? probeLegacy : probeNpu;
  const hint = useLegacyWhisper ? WHISPER_SETUP_HINT : WHISPER_NPU_SETUP_HINT;
  const cacheKey = useLegacyWhisper ? 'Legacy' : 'Npu';
  const getCache = () => (useLegacyWhisper ? cachedWhisperPythonLegacy : cachedWhisperPythonNpu);
  const setCache = (bin: string) => {
    if (useLegacyWhisper) cachedWhisperPythonLegacy = bin;
    else cachedWhisperPythonNpu = bin;
  };

  if (forcedPython) {
    const normalized = normalizeWhisperPythonCandidate(forcedPython);
    const result = probe(normalized);
    if (result.ok) {
      setCache(normalized);
      return normalized;
    }
    throw new Error(
      `VIDERE_WHISPER_PYTHON is set to '${normalized}' but is not usable for Whisper (${cacheKey}): ${result.reason}\n${hint}`
    );
  }

  if (getCache()) {
    return getCache() as string;
  }

  const isWin = process.platform === 'win32';
  const candidates = [
    // Unix venv
    '.venv-whisper/bin/python',
    '.venv-whisper/bin/python3',
    '.venv/bin/python',
    '.venv/bin/python3',
    'venv/bin/python',
    'venv/bin/python3',
    // Windows venv
    ...(isWin
      ? [
        path.join('.venv-whisper', 'Scripts', 'python.exe'),
        path.join('.venv-whisper', 'Scripts', 'python3.exe'),
        path.join('.venv', 'Scripts', 'python.exe'),
        path.join('.venv', 'Scripts', 'python3.exe'),
        path.join('venv', 'Scripts', 'python.exe'),
        path.join('venv', 'Scripts', 'python3.exe'),
      ]
      : []),
    'python3.12',
    '/opt/homebrew/bin/python3.12',
    'python3.11',
    'python3',
    'py',
    'python',
  ]
    .map((candidate) => normalizeWhisperPythonCandidate(candidate))
    .filter((candidate, index, all) => Boolean(candidate) && all.indexOf(candidate) === index);

  const failures: string[] = [];
  for (const candidate of candidates) {
    const isPathLike =
      candidate.includes(path.sep) || candidate.startsWith('.');
    if (isPathLike && !fs.existsSync(candidate)) {
      failures.push(`${candidate} (not found)`);
      continue;
    }

    const result = probe(candidate);
    if (result.ok) {
      setCache(candidate);
      return candidate;
    }
    failures.push(`${candidate} (${result.reason || 'probe failed'})`);
  }

  const what = useLegacyWhisper
    ? 'torch + transformers'
    : 'nexa-caption-lab[npu] (onnxruntime-qnn)';
  throw new Error(
    `No Python interpreter with ${what} was found. Tried: ${failures.join('; ')}\n${hint}`
  );
}

function runWhisperTranscription(
  jobs: WhisperClipJob[],
  model: string,
  timestamps: string,
  useLegacyWhisper: boolean = false,
  computeType: string = DEFAULT_WHISPER_COMPUTE_TYPE,
  chunkSeconds: number = DEFAULT_WHISPER_CHUNK_SECONDS
): Promise<TranscribeClipResult[]> {
  const scriptPath = useLegacyWhisper ? WHISPER_SCRIPT_PATH_LEGACY : WHISPER_SCRIPT_PATH_NPU;
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(scriptPath)) {
      reject(
        new Error(
          `Whisper runner script not found at ${scriptPath}.`
        )
      );
      return;
    }

    const pythonBin = resolveWhisperPython(useLegacyWhisper);
    const runner = spawn(pythonBin, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    runner.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    runner.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    runner.on('error', (error) => {
      reject(
        new Error(
          `Failed to launch Whisper runner (${pythonBin}): ${error.message}`
        )
      );
    });

    runner.on('close', (code) => {
      if (code !== 0) {
        const detail = stderr.trim() || 'Unknown Python runner failure.';
        reject(new Error(`Whisper runner exited with code ${code}: ${detail}`));
        return;
      }

      try {
        const rawStdout = (stdout || '').trim();
        const jsonLine =
          rawStdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .reverse()
            .find((line) => line.startsWith('{') && line.endsWith('}')) ||
          rawStdout ||
          '{}';
        const parsed = JSON.parse(jsonLine) as {
          results?: Array<Record<string, unknown>>;
        };
        if (!Array.isArray(parsed.results)) {
          reject(
            new Error(
              'Whisper runner returned an invalid payload (missing results array).'
            )
          );
          return;
        }

        const normalized: TranscribeClipResult[] = parsed.results.map((entry) => {
          const scrubberId = toSingleString(entry.scrubberId)?.trim() || 'unknown';
          return {
            scrubberId,
            text: toSingleString(entry.text)?.trim() || '',
            words: normalizeWords(entry.words),
            clipStartSec: toFiniteNumber(entry.clipStartSec) ?? 0,
            clipEndSec: toFiniteNumber(entry.clipEndSec) ?? 0,
            error: toSingleString(entry.error),
          };
        });

        resolve(normalized);
      } catch (error) {
        reject(
          new Error(
            `Failed to parse Whisper runner output: ${error instanceof Error ? error.message : String(error)
            }`
          )
        );
      }
    });

    const payload = JSON.stringify({
      model,
      timestamps,
      jobs,
      ffmpegBin: process.env.VIDERE_WHISPER_FFMPEG_BIN || 'ffmpeg',
      device: process.env.VIDERE_WHISPER_DEVICE || 'auto',
      computeType,
      chunkSeconds,
    });
    runner.stdin.write(payload);
    runner.stdin.end();
  });
}

// You only have to create a bundle once, and you may reuse it
// for multiple renders that you can parametrize using input props.
const bundleLocation = await bundle({
  entryPoint: path.resolve('./app/videorender/index.ts'),
  // If you have a webpack override in remotion.config.ts, pass it here as well.
  webpackOverride: (config) => config,
});

console.log(bundleLocation);

// Ensure output directory exists
ensureMediaRootDir();

const app = express();
app.use(express.json());
app.use(cors());

// Static file serving for the out/ directory
app.use('/media', express.static(OUT_DIR, {
  dotfiles: 'deny',
  index: false
}));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      const projectId = getProjectIdFromRequest(req);
      if (projectId) {
        cb(null, ensureProjectMediaDir(projectId));
        return;
      }
      ensureMediaRootDir();
      cb(null, OUT_DIR);
    } catch (error) {
      cb(error as Error, OUT_DIR);
    }
  },
  filename: (_req, file, cb) => {
    // Generate unique filename with timestamp
    const timestamp = Date.now();
    const originalName = file.originalname;
    const extension = path.extname(originalName);
    const nameWithoutExt = path.basename(originalName, extension);
    const uniqueName = `${nameWithoutExt}_${timestamp}${extension}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit (we'll do no limits later)
  },
  fileFilter: (req, file, cb) => {
    // Accept common media file types
    const allowedTypes = /\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|mp3|wav|aac|ogg|flac|jpg|jpeg|png|gif|bmp|webp)$/i;
    if (allowedTypes.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only media files are allowed.'));
    }
  }
});

// List files in out/ directory
app.get('/media', (req: Request, res: Response): void => {
  try {
    const projectId = normalizeProjectId(req.query.projectId);
    const listDir = projectId ? path.resolve(OUT_DIR, projectId) : OUT_DIR;
    if (!fs.existsSync(listDir)) {
      res.json({ files: [] });
      return;
    }

    const files = fs.readdirSync(listDir).map(filename => {
      const filePath = path.join(listDir, filename);
      const stats = fs.statSync(filePath);
      const storageKey = projectId ? `${projectId}/${filename}` : filename;
      return {
        name: filename,
        storageKey,
        url: toMediaUrl(storageKey),
        size: stats.size,
        modified: stats.mtime,
        isDirectory: stats.isDirectory()
      };
    }).filter(file => !file.isDirectory); // Only show files, not directories

    res.json({ files });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// File upload endpoint
app.post('/upload', upload.single('media'), (req: Request, res: Response): void => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const storageKey = getStorageKeyFromAbsolutePath(req.file.path);
    const fileUrl = toMediaUrl(storageKey);
    const fullUrl = `http://localhost:${port}${fileUrl}`; // Direct backend URL for Remotion

    console.log(`📁 File uploaded: ${req.file.originalname} -> ${storageKey}`);

    res.json({
      success: true,
      filename: storageKey,
      storageKey,
      originalName: req.file.originalname,
      url: fileUrl,
      fullUrl: fullUrl,
      size: req.file.size,
      path: req.file.path
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// Bulk file upload endpoint
app.post('/upload-multiple', upload.array('media', 10), (req: Request, res: Response): void => {
  try {
    if (!req.files || req.files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    const uploadedFiles = (req.files as Express.Multer.File[]).map(file => {
      const storageKey = getStorageKeyFromAbsolutePath(file.path);
      const fileUrl = toMediaUrl(storageKey);
      return {
        filename: storageKey,
        storageKey,
        originalName: file.originalname,
        url: fileUrl,
        fullUrl: `http://localhost:${port}${fileUrl}`, // Direct backend URL for Remotion
        size: file.size,
        path: file.path
      };
    });

    console.log(`📁 ${uploadedFiles.length} files uploaded`);

    res.json({
      success: true,
      files: uploadedFiles
    });
  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({ error: 'Bulk file upload failed' });
  }
});

// Clone/copy media file endpoint
app.post('/clone-media', (req: Request, res: Response): void => {
  try {
    const { filename, originalName, suffix } = req.body;

    if (!filename) {
      res.status(400).json({ error: 'Filename is required' });
      return;
    }

    const sourceStorageKey = String(filename);
    const sourcePath = resolveStoragePath(sourceStorageKey);

    if (!fs.existsSync(sourcePath)) {
      res.status(404).json({ error: 'Source file not found' });
      return;
    }

    // Generate new filename with timestamp and suffix
    const timestamp = Date.now();
    const safeSuffix = String(suffix || 'copy').replace(/[^a-zA-Z0-9_-]/g, '') || 'copy';
    const sourceExtension = path.extname(sourcePath);
    const sourceNameWithoutExt = path.basename(sourcePath, sourceExtension);
    const newFilename = `${sourceNameWithoutExt}_${safeSuffix}_${timestamp}${sourceExtension}`;
    const destPath = path.resolve(path.dirname(sourcePath), newFilename);
    if (!destPath.startsWith(path.resolve(OUT_DIR))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Copy the file
    fs.copyFileSync(sourcePath, destPath);

    const fileStats = fs.statSync(destPath);
    const clonedStorageKey = getStorageKeyFromAbsolutePath(destPath);
    const fileUrl = toMediaUrl(clonedStorageKey);
    const fullUrl = `http://localhost:${port}${fileUrl}`;

    console.log(`📋 File cloned: ${sourceStorageKey} -> ${clonedStorageKey}`);

    res.json({
      success: true,
      filename: clonedStorageKey,
      storageKey: clonedStorageKey,
      originalName: originalName || path.basename(sourceStorageKey),
      url: fileUrl,
      fullUrl: fullUrl,
      size: fileStats.size,
      path: destPath
    });
  } catch (error) {
    console.error('Clone error:', error);
    res.status(500).json({ error: 'Failed to clone file' });
  }
});

// Delete file endpoint
app.delete('/media/:filename', (req: Request, res: Response): void => {
  try {
    const param = req.params.filename;
    const rawFilename = Array.isArray(param) ? param[0] : param;
    if (!rawFilename) {
      res.status(400).json({ error: 'Filename is required' });
      return;
    }
    const filename = String(rawFilename);
    const filePath = resolveStoragePath(filename);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    fs.unlinkSync(filePath);
    console.log(`🗑️ File deleted: ${filename}`);

    res.json({
      success: true,
      message: `File ${filename} deleted successfully`
    });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

app.post('/analyze-transcript', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }

    const scrubberId = toSingleString(body.scrubberId)?.trim();
    if (!scrubberId) {
      res.status(400).json({ error: 'Missing scrubberId.' });
      return;
    }

    const text = toSingleString(body.text)?.trim() || '';
    const words = Array.isArray(body.words) ? body.words : [];

    if (!text || words.length === 0) {
      res.status(400).json({ error: 'Missing text or words for analysis.' });
      return;
    }

    const scriptPath = path.resolve('./app/videorender/llama_npu_analyze.py');
    if (!fs.existsSync(scriptPath)) {
      res.status(500).json({ error: `Analyzer script not found at ${scriptPath}` });
      return;
    }

    // Try to resolve the NPU/Whisper python environment first, 
    // where qai-hub-models should be installed
    let pythonBin = 'python';
    try {
      pythonBin = resolveWhisperPython(false);
    } catch (e) {
      if (process.platform !== 'win32') {
        pythonBin = fs.existsSync('/opt/homebrew/bin/python3') ? '/opt/homebrew/bin/python3' : 'python3';
      }
    }

    const runner = spawn(pythonBin, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    runner.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    runner.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    runner.on('close', (code) => {
      if (code !== 0) {
        const detail = stderr.trim() || 'Unknown Python runner failure.';
        res.status(500).json({ error: `LLM runner exited with code ${code}: ${detail}` });
        return;
      }

      try {
        const rawStdout = (stdout || '').trim();
        const jsonLine =
          rawStdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .reverse()
            .find((line) => line.startsWith('{') && line.endsWith('}')) ||
          rawStdout ||
          '{}';
        const parsed = JSON.parse(jsonLine);

        if (parsed.success === false) {
          res.status(500).json({ error: parsed.error || 'LLM analysis failed.' });
          return;
        }

        res.json({
          success: true,
          suggestions: parsed.suggestions || [],
          scrubberId: parsed.scrubberId
        });
      } catch (error) {
        res.status(500).json({
          error: `Failed to parse LLM runner output: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    });

    runner.on('error', (error) => {
      res.status(500).json({ error: `Failed to launch LLM runner: ${error.message}` });
    });

    const payload = JSON.stringify({
      scrubberId,
      text,
      words
    });
    runner.stdin.write(payload);
    runner.stdin.end();

  } catch (error) {
    console.error('Analyze error:', error);
    res.status(500).json({ error: 'Failed to analyze transcript' });
  }
});

app.post('/transcribe-clips', async (req: Request, res: Response): Promise<void> => {
  if (isTranscriptionRunning) {
    res.status(409).json({
      error: 'A transcription request is already running. Please wait for it to complete.',
    });
    return;
  }

  isTranscriptionRunning = true;
  try {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid request body.' });
      return;
    }

    const model = toSingleString(body.model)?.trim() || DEFAULT_WHISPER_MODEL;
    const timestamps = toSingleString(body.timestamps)?.trim() || DEFAULT_WHISPER_TIMESTAMPS;
    const useLegacyWhisper = Boolean(body.useLegacyWhisper);
    const computeType =
      toSingleString(body.computeType)?.trim() || DEFAULT_WHISPER_COMPUTE_TYPE;
    const chunkSecondsInput = toFiniteNumber(body.chunkSeconds);
    const chunkSeconds =
      chunkSecondsInput !== null && chunkSecondsInput > 0
        ? Math.min(Math.max(chunkSecondsInput, 5), 600)
        : DEFAULT_WHISPER_CHUNK_SECONDS;
    if (timestamps !== 'word') {
      res.status(400).json({ error: "Only timestamps='word' is supported." });
      return;
    }

    const rawClips = body.clips;
    if (!Array.isArray(rawClips) || rawClips.length === 0) {
      res.status(400).json({ error: 'At least one clip is required.' });
      return;
    }

    const orderedResults: TranscribeClipResult[] = [];
    const jobs: WhisperClipJob[] = [];
    const jobResultIndices = new Map<string, number>();

    for (const rawClip of rawClips) {
      if (!rawClip || typeof rawClip !== 'object') {
        orderedResults.push({
          scrubberId: `unknown-${orderedResults.length + 1}`,
          text: '',
          words: [],
          clipStartSec: 0,
          clipEndSec: 0,
          error: 'Clip item must be an object.',
        });
        continue;
      }
      const clip = rawClip as Record<string, unknown>;
      const scrubberId = toSingleString(clip.scrubberId)?.trim() || `unknown-${orderedResults.length + 1}`;
      const mediaType = toMediaType(clip.mediaType);
      if (!mediaType) {
        orderedResults.push({
          scrubberId,
          text: '',
          words: [],
          clipStartSec: 0,
          clipEndSec: 0,
          error: 'Missing or invalid mediaType.',
        });
        continue;
      }

      if (mediaType !== 'video' && mediaType !== 'audio') {
        orderedResults.push({
          scrubberId,
          text: '',
          words: [],
          clipStartSec: 0,
          clipEndSec: 0,
          error: `Unsupported media type for transcription: ${mediaType}`,
        });
        continue;
      }

      const storageKey = toSingleString(clip.storageKey)?.trim();
      if (!storageKey) {
        orderedResults.push({
          scrubberId,
          text: '',
          words: [],
          clipStartSec: 0,
          clipEndSec: 0,
          error: 'Missing storageKey.',
        });
        continue;
      }

      const durationInSeconds = toFiniteNumber(clip.durationInSeconds);
      if (durationInSeconds === null || durationInSeconds <= 0) {
        orderedResults.push({
          scrubberId,
          text: '',
          words: [],
          clipStartSec: 0,
          clipEndSec: 0,
          error: 'Missing or invalid durationInSeconds.',
        });
        continue;
      }

      const trimBeforeFrames = toNonNegativeInteger(clip.trimBeforeFrames);
      const trimAfterFrames = toNonNegativeInteger(clip.trimAfterFrames);
      const clipStartSec = Math.max(0, trimBeforeFrames / FPS);
      const clipEndSec = Math.max(
        clipStartSec + 0.01,
        durationInSeconds - trimAfterFrames / FPS
      );

      let inputPath: string;
      try {
        inputPath = resolveStoragePath(storageKey);
      } catch (error) {
        orderedResults.push({
          scrubberId,
          text: '',
          words: [],
          clipStartSec,
          clipEndSec,
          error:
            error instanceof Error
              ? `Invalid storage key: ${error.message}`
              : 'Invalid storage key.',
        });
        continue;
      }
      if (!fs.existsSync(inputPath)) {
        orderedResults.push({
          scrubberId,
          text: '',
          words: [],
          clipStartSec,
          clipEndSec,
          error: `Media file not found for storage key: ${storageKey}`,
        });
        continue;
      }

      orderedResults.push({
        scrubberId,
        text: '',
        words: [],
        clipStartSec,
        clipEndSec,
        error: null,
      });
      jobResultIndices.set(scrubberId, orderedResults.length - 1);
      jobs.push({
        scrubberId,
        inputPath,
        startSec: clipStartSec,
        endSec: clipEndSec,
      });
    }

    if (jobs.length > 0) {
      let whisperResults: TranscribeClipResult[] = [];
      let runnerError: string | null = null;
      try {
        whisperResults = await runWhisperTranscription(
          jobs,
          model,
          timestamps,
          useLegacyWhisper,
          computeType,
          chunkSeconds
        );
      } catch (error) {
        runnerError =
          error instanceof Error
            ? error.message
            : 'Unknown error while running transcription.';
      }

      const resultById = new Map(
        whisperResults.map((result) => [result.scrubberId, result])
      );
      for (const job of jobs) {
        const resultIndex = jobResultIndices.get(job.scrubberId);
        if (typeof resultIndex !== 'number') continue;
        const existing = orderedResults[resultIndex];
        const fromRunner = resultById.get(job.scrubberId);
        if (fromRunner) {
          orderedResults[resultIndex] = {
            scrubberId: job.scrubberId,
            text: fromRunner.text || '',
            words: fromRunner.words || [],
            clipStartSec: Number.isFinite(fromRunner.clipStartSec)
              ? fromRunner.clipStartSec
              : existing.clipStartSec,
            clipEndSec: Number.isFinite(fromRunner.clipEndSec)
              ? fromRunner.clipEndSec
              : existing.clipEndSec,
            error: fromRunner.error || null,
          };
          continue;
        }

        orderedResults[resultIndex] = {
          ...existing,
          error: runnerError || 'No transcription result was returned for this clip.',
        };
      }
    }

    res.json({
      model,
      timestamps,
      results: orderedResults,
    });
  } catch (error) {
    console.error('Transcribe clips error:', error);
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Failed to transcribe clips.',
    });
  } finally {
    isTranscriptionRunning = false;
  }
});

// Health check endpoint to monitor system resources
app.get('/health', (req, res) => {
  const used = process.memoryUsage();
  res.json({
    status: 'ok',
    memory: {
      rss: `${Math.round(used.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)} MB`,
    },
    uptime: `${Math.round(process.uptime())} seconds`
  });
});

app.post('/render', async (req, res) => {
  try {
    // Get input props from POST body
    const inputProps = {
      timelineData: req.body.timelineData,
      durationInFrames: req.body.durationInFrames,
      compositionWidth: req.body.compositionWidth,
      compositionHeight: req.body.compositionHeight,
      getPixelsPerSecond: req.body.getPixelsPerSecond,
      isRendering: true,
    };

    // console.log("Input props:", typeof inputProps.compositionWidth);
    console.log("Input props:", JSON.stringify(inputProps, null, 2));
    // Get the composition you want to render
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: compositionId,
      inputProps,
    });

    // const maxFrames = Math.min(composition.durationInFrames, 150); // Max 5 seconds at 30fps
    // console.log(`Starting ULTRA low-resource render. Limiting to ${maxFrames} frames (${maxFrames / 30}s)`);

    // Render optimized for 4vCPU, 8GB RAM server
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: path.join(OUT_DIR, `${compositionId}.mp4`),
      inputProps,
      // Optimized settings for server hardware
      concurrency: 3, // Use 3 cores, leave 1 for system
      verbose: true,
      logLevel: 'info', // More detailed logging for server monitoring
      // Balanced encoding settings for server performance
      ffmpegOverride: ({ args }) => {
        return [
          ...args,
          '-preset', 'fast', // Good balance of speed and quality
          '-crf', '28', // Better quality than ultrafast setting
          '-threads', '3', // Use 3 threads for encoding
          '-tune', 'film', // Better quality for general content
          '-x264-params', 'ref=3:me=hex:subme=6:trellis=1', // Better quality settings
          '-g', '30', // Standard keyframe interval
          '-bf', '2', // Allow some B-frames for better compression
          '-maxrate', '5M', // Limit bitrate to prevent memory issues
          '-bufsize', '10M', // Buffer size for rate control
        ];
      },
      timeoutInMilliseconds: 900000, // 15 minute timeout for longer videos
    });

    console.log('✅ Render completed successfully');
    res.sendFile(path.resolve(OUT_DIR, `${compositionId}.mp4`));

  } catch (err) {
    console.error('❌ Render failed:', err);

    // Clean up failed renders
    try {
      const outputPath = path.resolve(OUT_DIR, `${compositionId}.mp4`);
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
        console.log('🧹 Cleaned up partial file');
      }
    } catch (cleanupErr) {
      console.warn('⚠️ Could not clean up:', cleanupErr);
    }

    res.status(500).json({
      error: 'Video rendering failed',
      message: 'Your laptop might be under heavy load. Try closing other apps and rendering again.',
      tip: 'Videos are limited to 5 seconds at half resolution for performance.'
    });
  }
});

const port = process.env.PORT || 8000;
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
  console.log(`📊 Health check: http://localhost:${port}/health`);
  console.log(`🎬 Video rendering: POST http://localhost:${port}/render`);
  console.log(`📁 Media files: http://localhost:${port}/media/`);
  console.log(`📤 Upload file: POST http://localhost:${port}/upload`);
  console.log(`📤 Upload multiple: POST http://localhost:${port}/upload-multiple`);
  console.log(`📋 Clone media: POST http://localhost:${port}/clone-media`);
  console.log(`🗑️ Delete file: DELETE http://localhost:${port}/media/:filename`);
  console.log(`📝 Transcribe clips: POST http://localhost:${port}/transcribe-clips`);
  console.log(`🖥️ Optimized for 4vCPU, 8GB RAM server:`);
  console.log(`   - Multi-threaded processing (3 cores)`);
  console.log(`   - Balanced quality/speed encoding`);
  console.log(`   - Full resolution rendering`);
  console.log(`   - 15-minute timeout for longer videos`);
  console.log(`📂 Media files are served from: ${OUT_DIR}`);
});
