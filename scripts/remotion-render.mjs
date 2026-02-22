#!/usr/bin/env node

/**
 * Placeholder Remotion runner entrypoint.
 *
 * This script is intentionally lightweight in this phase of the cutover.
 * The desktop runtime checks for this file to determine whether Remotion
 * export wiring is available in dev builds.
 */

console.error(
  "remotion-render.mjs is present but not wired for direct CLI usage yet. Render requests should go through Tauri commands.",
);
process.exit(1);
