import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'path';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import multer from 'multer';

// The composition you want to render
const compositionId = 'TimelineComposition';
const OUT_DIR = path.resolve(process.env.VIDERE_MEDIA_DIR || 'out');
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

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
  console.log(`🖥️ Optimized for 4vCPU, 8GB RAM server:`);
  console.log(`   - Multi-threaded processing (3 cores)`);
  console.log(`   - Balanced quality/speed encoding`);
  console.log(`   - Full resolution rendering`);
  console.log(`   - 15-minute timeout for longer videos`);
  console.log(`📂 Media files are served from: ${OUT_DIR}`);
});
