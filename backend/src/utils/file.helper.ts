import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';

/**
 * Safely resolve a file path within the temp directory.
 * Returns null if the path would escape the temp directory (path traversal guard).
 */
export function safeTempPath(projectId: string, filename: string): string | null {
  const tempDir = path.resolve(env.TEMP_DIR);
  // Use basename to strip any directory components from the filename
  const safeName = path.basename(filename);
  const resolved = path.resolve(tempDir, projectId, safeName);

  if (!resolved.startsWith(tempDir + path.sep) && resolved !== tempDir) {
    return null;
  }
  return resolved;
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Delete a project's temp directory and all its contents.
 */
export function cleanupProjectTemp(projectId: string): void {
  const tempDir = path.join(env.TEMP_DIR, projectId);
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Delete temp directories older than the given age in milliseconds.
 */
export function cleanupOldTempDirs(maxAgeMs: number): void {
  const tempDir = env.TEMP_DIR;
  if (!fs.existsSync(tempDir)) return;

  const entries = fs.readdirSync(tempDir, { withFileTypes: true });
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(tempDir, entry.name);
    const stats = fs.statSync(fullPath);
    if (now - stats.mtimeMs > maxAgeMs) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`[Cleanup] Removed old temp dir: ${fullPath}`);
    }
  }
}
