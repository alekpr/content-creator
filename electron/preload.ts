/**
 * Electron Preload Script
 *
 * Runs in a privileged context with access to both the DOM (renderer) and
 * limited Node/Electron APIs. Exposes a safe, typed surface to the renderer
 * via contextBridge — nothing else is reachable from the renderer.
 *
 * Security rules:
 *   - contextIsolation: true  → renderer JS cannot reach this scope
 *   - nodeIntegration: false  → no require() in renderer
 *   - Only expose the minimum set of capabilities the UI needs
 */

import { contextBridge, ipcRenderer } from 'electron';

const electronAPI = {
  /** Returns the path to the app's user data directory (macOS: ~/Library/Application Support/<name>) */
  getDataPath: (): Promise<string> =>
    ipcRenderer.invoke('app:get-data-path'),

  /** Returns the version string from package.json */
  getVersion: (): Promise<string> =>
    ipcRenderer.invoke('app:get-version'),

  /**
   * Opens the macOS Finder and selects the specified file.
   * Useful for "Reveal output file" actions in the UI.
   */
  showItemInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('app:show-item-in-folder', filePath),

  /** True when running inside the Electron desktop app */
  isElectron: true as const,
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// ─── Type declaration (consumed by frontend TypeScript) ───────────────────────
// The renderer can import this type via:
//   declare const window: Window & typeof globalThis & { electronAPI: ElectronAPI }
export type ElectronAPI = typeof electronAPI;
