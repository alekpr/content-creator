# Content Creator — Electron macOS Migration Plan

## Overview

แผนนี้ครอบคลุมการแปลง **content-creator** จาก web-only monorepo ให้กลายเป็น macOS desktop application โดยใช้ [Electron](https://www.electronjs.org/) เป็น shell หลัก

**เป้าหมาย V1 (ปัจจุบัน)**
- แอปเดสก์ท็อปที่เปิดใช้งานด้วยคำสั่งเดียว
- Unsigned build สำหรับแจกภายในทีม (ไม่ผ่าน App Store)
- MongoDB + Redis ยังรันเป็น local external service
- โค้ดเดิมทั้ง frontend/backend ถูกนำมาใช้ซ้ำโดยไม่ต้องเขียนใหม่

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                Electron Main Process                    │
│  electron/main.ts (compiled → electron-dist/main.js)   │
│                                                         │
│  • App lifecycle (window, quit, IPC handlers)           │
│  • Spawns backend as child process                      │
│  • Polls /health before showing window                  │
│  • Builds backend env from .env file + computed paths   │
└────────────────┬───────────────────────────────────────-┘
                 │  child_process.spawn()
                 ▼
┌────────────────────────────────────────────────────────-┐
│              Backend Child Process                      │
│  Node.js (Electron's bundled runtime in prod,           │
│           tsx watch in dev)                             │
│                                                         │
│  • Express REST API on localhost:3001                   │
│  • Socket.io (real-time stage progress)                 │
│  • BullMQ worker (video assembly jobs)                  │
│  • Dev mode:  connects to MongoDB/Redis normally        │
│  • Prod mode: also serves frontend/dist as static files │
└────────────────┬───────────────────────────────────────-┘
                 │  HTTP + WebSocket (localhost:3001)
                 ▼
┌────────────────────────────────────────────────────────-┐
│           Electron Renderer Process                     │
│  electron/preload.ts (contextBridge — sandboxed)        │
│                                                         │
│  • React SPA — unchanged frontend code                  │
│  • Dev:  loads from Vite dev server (localhost:5173)    │
│  • Prod: loads from http://localhost:3001               │
│  • All API calls via existing fetch + socket.io-client  │
└────────────────────────────────────────────────────────-┘
```

### Key design decision: Backend serves frontend in production

ใน production build, backend (Express) เสิร์ฟ `frontend/dist/` เป็น static files
เพราะฉะนั้น renderer (**http://localhost:3001**) และ backend (**http://localhost:3001**) อยู่ที่ same origin →
ไม่มี CORS headers ที่ต้องจัดการ และ Socket.io ทำงานได้ตามปกติ

ใน development, Vite dev server (**localhost:5173**) ยังทำหน้าที่เป็น proxy ไปยัง backend (**localhost:3001**) เหมือนเดิม

---

## Files Changed / Added

### New Files

| Path | Purpose |
|------|---------|
| `electron/main.ts` | Electron main process — lifecycle, backend spawn, window creation |
| `electron/preload.ts` | Sandboxed IPC bridge (contextBridge) |
| `tsconfig.electron.json` | TypeScript config for Electron main/preload (target: CommonJS) |
| `docs/electron-macos-plan.md` | This file |

### Modified Files

| Path | Change |
|------|--------|
| `package.json` (root) | + electron, electron-builder devDeps; + electron:* scripts; + `build` config for packaging |
| `backend/src/app.ts` | + Static file serving when `SERVE_FRONTEND=true` (Electron prod only) |
| `backend/src/config/env.ts` | `FRONTEND_URL` now has a `.default()` (safe fallback for Electron mode) |

### Unchanged Files (by design)

- `frontend/src/api/client.ts` — already uses `VITE_API_URL ?? ''` (relative URLs work in prod)
- `frontend/src/hooks/useSocket.ts` — same pattern, connects to same origin
- `backend/src/server.ts` — standalone entrypoint kept intact; web mode unaffected
- `backend/src/socket/socket.handler.ts` — CORS still uses `env.FRONTEND_URL`
- All stage pipeline files

---

## Environment Variables

### Dev mode (loaded from `backend/.env`)

```env
# Required — same as web dev
MONGODB_URI=mongodb://localhost:27017/content-creator
REDIS_URL=redis://localhost:6379
GEMINI_API_KEY=your-key-here

# Automatically overridden by Electron main process
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:5173
TEMP_DIR=<project-root>/backend/temp
OUTPUT_DIR=<project-root>/backend/output
ELECTRON_MODE=true
```

### Production mode (loaded from `~/Library/Application Support/Content Creator/.env`)

```env
# Required — user must create this file before first launch
MONGODB_URI=mongodb://localhost:27017/content-creator
REDIS_URL=redis://localhost:6379
GEMINI_API_KEY=your-key-here

# Automatically overridden — do NOT set these manually
# NODE_ENV, PORT, FRONTEND_URL, TEMP_DIR, OUTPUT_DIR, SERVE_FRONTEND, FRONTEND_DIST_DIR
```

> **Important:** ไฟล์ `~/Library/Application Support/Content Creator/.env` จะต้องถูกสร้างก่อนเปิดแอปครั้งแรกในทุก machine ที่ใช้ production build

---

## Prerequisites (ทุก mode)

```bash
# MongoDB (via Homebrew)
brew install mongodb-community
brew services start mongodb-community

# Redis (via Homebrew)
brew install redis
brew services start redis

# Node.js 22+ (required for tsx)
brew install node

# FFmpeg (for video/audio processing)
brew install ffmpeg
```

---

## Development Workflow

### Option A — Electron dev mode (recommended for desktop feature work)

```bash
# ติดตั้ง dependencies (ครั้งแรกหรือหลัง pull)
npm install

# รัน Electron app พร้อม hot-reload
npm run electron:dev
```

กระบวนการ:
1. Compile `electron/main.ts` → `electron-dist/main.js`
2. `concurrently` เริ่ม Vite dev server (port 5173) และ Electron
3. Electron main spawns backend ด้วย `tsx watch` (hot-reload)
4. Electron main polls `/health` จนพร้อม จึงเปิดหน้าต่าง
5. Renderer โหลดจาก `http://localhost:5173` (Vite)

### Option B — Web dev mode (ไม่มี Electron)

```bash
npm run dev
```

ทำงานได้ตามปกติ ไม่ได้รับผลกระทบจากการเพิ่ม Electron

---

## Production Build Workflow

```bash
# 1. Build all workspaces + compile Electron main
npm run electron:build

# 2. Package เป็น macOS .app + .dmg
npm run electron:package          # ทั้ง arm64 และ x64
npm run electron:package:arm64    # เฉพาะ Apple Silicon
npm run electron:package:x64      # เฉพาะ Intel Mac

# Output: release/Content Creator-<version>-arm64.dmg
```

ขั้นตอนภายใน `electron:build`:
1. `npm run build` → compile shared → backend → frontend
2. `tsc -p tsconfig.electron.json` → compile electron/main.ts + preload.ts

---

## Runtime Behavior

### Startup sequence

```
Electron app opens
  └─▶ electron/main.ts bootstrap()
        ├─▶ buildBackendEnv()          # merge .env + Electron overrides
        ├─▶ spawnBackend()             # child_process.spawn(node server.js)
        ├─▶ waitForBackend(25s)        # poll GET /health until 200 OK
        │     ├─ success → createWindow() + loadURL(...)
        │     └─ timeout → showErrorBox() + app.quit()
        └─▶ registerIPCHandlers()
```

### Graceful shutdown

```
User quits app (Cmd+Q)
  └─▶ app.on('before-quit')
        └─▶ stopBackend()              # SIGTERM → child process
              └─▶ backend SIGTERM handler → closeDB() → process.exit(0)
```

---

## IPC API (window.electronAPI)

Exposed via `electron/preload.ts` — available in the renderer at `window.electronAPI`:

```typescript
interface ElectronAPI {
  isElectron: true                                // detect if running in Electron
  getDataPath(): Promise<string>                  // ~/Library/Application Support/Content Creator
  getVersion(): Promise<string>                   // app version from package.json
  showItemInFolder(filePath: string): Promise<void> // open Finder at file location
}
```

Usage in frontend:
```typescript
if ('electronAPI' in window) {
  const dataPath = await window.electronAPI.getDataPath();
}
```

---

## File Storage

| Mode | TEMP_DIR | OUTPUT_DIR |
|------|----------|------------|
| Web dev | `backend/temp/` | `backend/output/` |
| Electron dev | `backend/temp/` | `backend/output/` |
| Electron prod | `~/Library/Application Support/Content Creator/temp/` | `~/Library/Application Support/Content Creator/output/` |

Path-traversal protection ใน `file.helper.ts` ยังคงทำงานได้ถูกต้องในทุก path ที่ใช้

---

## Packaging Details (electron-builder)

Config อยู่ใน root `package.json` → `"build"` key:

```
Output: release/
Format: .dmg (อนุญาตให้ drag-drop ไป /Applications)
asar:   false (ง่ายต่อการ debug สำหรับ V1)
arch:   arm64, x64 (universal)
```

**Packaged app layout:**
```
Content Creator.app/
  Contents/
    MacOS/
      Content Creator          (Electron binary)
    Resources/
      app/
        electron-dist/         (compiled Electron main + preload)
        backend/dist/          (compiled backend)
        frontend/dist/         (built React SPA)
        shared/dist/           (compiled shared types)
        node_modules/          (all dependencies)
        package.json
```

---

## Troubleshooting

### แอปไม่เปิด / Backend timeout

1. ตรวจสอบว่า MongoDB รันอยู่: `brew services list | grep mongodb`
2. ตรวจสอบว่า Redis รันอยู่: `brew services list | grep redis`
3. ตรวจสอบ `.env` ที่ `~/Library/Application Support/Content Creator/.env`
4. ดู logs ใน Console.app → ค้นหา "Content Creator"

### `tsx` not found เมื่อรัน electron:dev

```bash
# ตรวจสอบว่า tsx อยู่ใน node_modules
ls node_modules/.bin/tsx

# ถ้าไม่มี ให้ install อีกครั้ง
npm install
```

### FFmpeg ไม่พบ

```bash
# ตรวจสอบ path ใน backend/.env
which ffmpeg

# อัปเดต FFMPEG_PATH ใน .env
FFMPEG_PATH=/opt/homebrew/bin/ffmpeg   # Apple Silicon
FFMPEG_PATH=/usr/local/bin/ffmpeg      # Intel Mac
```

### หน้าจอขาว / Frontend ไม่โหลด (prod build)

```bash
# ตรวจสอบว่า frontend ถูก build แล้ว
ls frontend/dist/index.html

# rebuild
npm run electron:build
```

---

## Security

| Feature | Status |
|---------|--------|
| `contextIsolation: true` | ✅ renderer ไม่เข้าถึง Node APIs |
| `nodeIntegration: false` | ✅ ไม่มี require() ใน renderer |
| `sandbox: true` | ✅ renderer process sandboxed |
| preload IPC channel whitelist | ✅ เฉพาะ channel ที่ประกาศใน preload.ts |
| path traversal guard | ✅ อยู่ใน `file.helper.ts` (ไม่เปลี่ยนแปลง) |
| external link policy | ✅ เปิดใน browser แทน Electron window ใหม่ |
| code signing / notarization | ⏳ Phase ถัดไป |

---

## Future Roadmap

### Phase 2 — Code Signing & Distribution

```bash
# เพิ่มใน package.json build config
"mac": {
  "identity": "Developer ID Application: Your Name (TEAMID)",
  "notarize": { "teamId": "TEAMID" }
}
# + @electron/notarize package
# + Apple Developer Program membership
```

### Phase 3 — Embedded Data Layer

แทนที่ MongoDB/Redis ด้วย embedded alternatives เพื่อ zero-dependency setup:
- **MongoDB** → `mongodb-memory-server` (ephemeral) หรือ `nedb`/SQLite (persistent)  
- **Redis/BullMQ** → `bullmq` ด้วย in-memory adapter (single-user desktop mode)

### Phase 4 — Auto-update

```bash
npm install electron-updater
# + เพิ่ม update server หรือ GitHub Releases
```

### Phase 5 — App Store Distribution

- Hardened Runtime entitlements
- App Sandbox rules สำหรับ file access
- macOS App Store assets (screenshots, description)
