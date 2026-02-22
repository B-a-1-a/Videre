/**
 * Patch @remotion/renderer to support Windows ARM64 by using x64 binaries via emulation.
 * Run this after `pnpm install` to apply the patch automatically.
 */
const fs = require('fs');
const path = require('path');

if (process.platform !== 'win32' || process.arch !== 'arm64') {
    console.log('[patch-remotion-arm64] Skipping: not Windows ARM64');
    process.exit(0);
}

const rendererBase = path.join(
    __dirname,
    '..',
    'node_modules',
    '@remotion',
    'renderer',
    'dist'
);

const filesToPatch = [
    path.join(rendererBase, 'compositor', 'get-executable-path.js'),
    path.join(rendererBase, 'esm', 'index.mjs'),
];

let patched = 0;

for (const filePath of filesToPatch) {
    if (!fs.existsSync(filePath)) {
        console.warn(`[patch-remotion-arm64] File not found: ${filePath}`);
        continue;
    }

    let content = fs.readFileSync(filePath, 'utf8');

    // Pattern: the win32 switch only has 'x64' and then 'default' throwing
    // We insert 'arm64' case before 'default' to reuse x64 binaries
    const needle = `throw new Error(\`Unsupported architecture on Windows: \${process.arch}\`)`;
    if (!content.includes(needle)) {
        console.log(`[patch-remotion-arm64] Already patched or pattern not found: ${path.basename(filePath)}`);
        continue;
    }

    // Check if already patched
    if (content.includes(`case 'arm64':`) || content.includes(`case "arm64":`)) {
        const arm64Index = content.indexOf(`case 'arm64':`) !== -1
            ? content.indexOf(`case 'arm64':`)
            : content.indexOf(`case "arm64":`);
        const windowsIndex = content.lastIndexOf('win32', arm64Index);
        const darwinIndex = content.lastIndexOf('darwin', arm64Index);
        // Only skip if the arm64 case is inside the win32 block (not darwin)
        if (windowsIndex > darwinIndex) {
            console.log(`[patch-remotion-arm64] Already patched: ${path.basename(filePath)}`);
            continue;
        }
    }

    // For CJS files
    const cjsPattern = `case 'x64':\n                    return require('@remotion/compositor-win32-x64-msvc').dir;\n                default:`;
    if (content.includes(cjsPattern)) {
        content = content.replace(
            cjsPattern,
            `case 'x64':\n                    return require('@remotion/compositor-win32-x64-msvc').dir;\n                case 'arm64':\n                    return require('@remotion/compositor-win32-x64-msvc').dir;\n                default:`
        );
        fs.writeFileSync(filePath, content, 'utf8');
        patched++;
        console.log(`[patch-remotion-arm64] Patched (CJS): ${path.basename(filePath)}`);
        continue;
    }

    // For ESM files
    const esmPattern = `case "x64":
          return __require("@remotion/compositor-win32-x64-msvc").dir;
        default:
          throw new Error(\`Unsupported architecture on Windows: \${process.arch}\`);`;
    if (content.includes(esmPattern)) {
        content = content.replace(
            esmPattern,
            `case "x64":
          return __require("@remotion/compositor-win32-x64-msvc").dir;
        case "arm64":
          return __require("@remotion/compositor-win32-x64-msvc").dir;
        default:
          throw new Error(\`Unsupported architecture on Windows: \${process.arch}\`);`
        );
        fs.writeFileSync(filePath, content, 'utf8');
        patched++;
        console.log(`[patch-remotion-arm64] Patched (ESM): ${path.basename(filePath)}`);
        continue;
    }

    console.warn(`[patch-remotion-arm64] Could not match patch pattern in: ${path.basename(filePath)}`);
}

console.log(`[patch-remotion-arm64] Done. Patched ${patched} file(s).`);
