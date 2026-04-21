# 🎬 Content Creator — AI Video Generation Platform

A **semi-automatic AI video generation platform** that transforms a simple topic into a fully assembled video. The workflow gives creators full control through a human-in-the-loop design: review and approve each stage before moving on, edit prompts, regenerate individual scenes, and track generation costs in real time.

---

## ✨ Features

- **6-Stage AI Pipeline** — Storyboard → Images → Videos → Voiceover → Music → Assembly
- **Human-in-the-Loop** — Review and approve every stage; edit prompts and regenerate at any step
- **Per-Stage Model Selection** — Choose AI model tier per stage before generating (e.g. Flash Lite / Flash / Pro for storyboard; Veo Lite / Fast / Full for video)
- **Manual Upload (Images & Videos)** — Skip AI generation for any scene by uploading your own image or video clip directly; manual scenes are marked with an emerald badge and excluded from AI generation
- **Pre-Generation Setup Panel** — Before generating, review all scenes in a grid; choose per-scene whether to let AI generate or upload your own asset
- **Image Reference Upload** — Upload a reference image per scene for Stage 2; multimodal Gemini call uses it as visual context
- **Platform Aspect Ratio** — Images and videos are generated at the correct aspect ratio per platform: 16:9 for YouTube/LinkedIn, 9:16 for TikTok/Instagram; thumbnails in the UI follow the same ratio
- **Version Tracking & Selection** — Every regeneration creates a new versioned file (v1, v2, …); version badges let you switch which version flows into the next stage without losing any previous result
- **Download Buttons** — Download any generated asset (image, video clip, audio file) directly from the review panel
- **Real-time Progress** — WebSocket events stream progress percentage and status updates to the UI
- **Cost Tracking** — Estimated cost shown before generation; actual cost tracked per stage and displayed on the dashboard (actual vs. estimate)
- **Multi-Platform Support** — YouTube (16:9), TikTok/Instagram (9:16), LinkedIn
- **Multi-Language** — English, Thai, Japanese, Chinese, Korean
- **Voice Selection** — 5 AI voices: Puck, Charon, Kore, Fenrir, Aoede
- **Optional Background Music** — Mood-driven AI music generation, mixable with voiceover
- **Scene-Level Regeneration** — Regenerate individual scenes without restarting the whole pipeline; Refine (append to original prompt) or Full (replace prompt entirely)
- **Generation History** — All attempts stored with prompts, costs, and metadata
- **Monorepo Workspace** — Shared TypeScript types between frontend and backend
- **Docker Ready** — Full `docker-compose` setup for local and production deployment

---

## 🛠️ Tech Stack

### Backend
| Tool | Purpose |
|------|---------|
| **Node.js + TypeScript** | Runtime & language |
| **Express.js v5** | REST API framework |
| **MongoDB 7 + Mongoose** | Project & generation log storage |
| **Redis 7 + BullMQ** | Async job queue for video generation |
| **Socket.io** | Real-time WebSocket progress events |
| **FFmpeg (fluent-ffmpeg)** | Video concatenation & audio mixing |
| **Zod** | Runtime schema validation |
| **express-rate-limit** | API rate limiting |

### AI APIs (Google GenAI)
| Model | Stage | Purpose |
|-------|-------|---------|
| `gemini-2.5-flash-lite` / `flash` / `pro` | Stage 1 | Storyboard generation (JSON output) |
| `gemini-2.5-flash-lite` / `flash` | Stage 2 | Image generation (PNG per scene), optional multimodal reference |
| `veo-3.1-lite` / `fast` / `full` `-generate-preview` | Stage 3 | Video generation (async + polling) |
| `gemini-2.5-flash-preview-tts` / `pro-preview-tts` | Stage 4 | Text-to-speech voiceover |
| `lyria-3-clip-preview` / `lyria-3-pro-preview` | Stage 5 | Background music generation |

> The default model for each stage is shown in bold. The per-stage model picker in the UI lets you upgrade or downgrade before each generation.

### Frontend
| Tool | Purpose |
|------|---------|
| **React 18 + Vite** | UI framework & dev server |
| **TypeScript** | Type safety |
| **React Router v6** | Client-side routing |
| **Zustand** | State management |
| **Tailwind CSS** | Utility-first styling |
| **Socket.io Client** | Real-time progress subscription |

---

## 🗺️ Architecture

```
┌─────────────────────────────────────────┐
│       Frontend (React + Vite :5173)     │
│  Pages: Home (list), Project (detail)   │
│  Stage panels per pipeline step         │
│  Zustand store + WebSocket listeners    │
└───────────────┬─────────────────────────┘
                │  REST API + WebSocket
                ▼
┌──────────────────────────────────────────────────────────────┐
│              Backend (Express :3001)                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  REST Routes (/api/projects, /api/files, /health)     │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Pipeline: Stage 1→2→3→4→5→6                         │  │
│  │  Each stage: generate → emit progress → await approval │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  BullMQ Worker — async Veo job polling                │  │
│  │  Exponential backoff (10s→60s, max 30 min)            │  │
│  └────────────────────────────────────────────────────────┘  │
└──────┬──────────────────────────────┬────────────────────────┘
       │                              │
       ▼                              ▼
  MongoDB 7                       Redis 7
  (projects, logs)           (BullMQ job queues)
```

---

## 🔄 Pipeline Stages

### Stage 1 — Storyboard
- **Model**: `gemini-2.5-flash` (JSON mode)  
- Generates scene list with narration, visual prompts, camera motion, mood  
- Scene count: 4 (30s) / 8 (60s) / 20 (3min)  
- **Cost**: ~$0.001 per generation

### Stage 2 — Images
- **Model**: `gemini-2.5-flash-lite` or `gemini-2.5-flash` *(selectable)*  
- One PNG generated per scene (16:9 or 9:16 depending on platform), all in parallel  
- **Reference image** — upload a JPEG/PNG/WebP reference per scene; Gemini uses it as multimodal input; reference is auto-resized to target dimensions before sending  
- **Manual upload** — upload your own image for any scene; that scene is skipped by AI generation; removable to revert to AI  
- **FFmpeg post-crop** — Gemini output is always post-cropped to the exact target resolution to guarantee correct orientation  
- **Cost**: ~$0.039 per image

### Stage 3 — Videos
- **Model**: `veo-3.1-lite` / `fast` / `full` `-generate-preview` *(selectable)*  
- Each scene submitted as a BullMQ job; worker polls until complete  
- Aspect ratio: 16:9 (YouTube/LinkedIn) or 9:16 (TikTok/Instagram)  
- **Manual upload** — upload your own MP4/WebM/MOV for any scene; those scenes are excluded from Veo generation  
- **Cost**: ~$0.10 per second of video

### Stage 4 — Voiceover
- **Model**: `gemini-2.5-flash-preview-tts` or `gemini-2.5-pro-preview-tts` *(selectable)*  
- All scene narrations concatenated into a single script → MP3  
- 5 voice options, adjustable speed  
- **Cost**: ~$0.001 per generation

### Stage 5 — Music *(Optional)*
- **Model**: `lyria-3-clip-preview` or `lyria-3-pro-preview` *(selectable)*  
- 30-second loopable background music clip based on mood  
- **Cost**: ~$0.04 per clip

### Stage 6 — Assembly
- **Tool**: FFmpeg  
- Concatenates video clips → mixes voiceover + music → re-encodes H.264/AAC  
- Adjustable voice/music volume levels  
- Output: downloadable MP4 with `faststart` flag for streaming

---

## 💰 Cost Estimates

| Stage | Cost per Unit |
|-------|--------------|
| Storyboard | $0.001 / generation |
| Images | $0.039 / scene |
| Videos | $0.10 / second |
| Voiceover | $0.001 / generation |
| Music | $0.04 / clip (optional) |

**Example — 30-second video (4 scenes):** ~$2.20  
**Example — 60-second video (8 scenes):** ~$4.31

---

## 🚀 Getting Started

### Prerequisites
- [Node.js 22+](https://nodejs.org)
- [Docker & Docker Compose](https://docs.docker.com/get-docker/) — or install services locally (see [macOS Local Setup](#-macos-local-setup-without-docker) below)
- [Google GenAI API Key](https://aistudio.google.com/app/apikey) (with Gemini, Veo, Lyria access)
- FFmpeg — required for image/video processing (see below)

### Option A: Docker Compose (Recommended)

```bash
# 1. Clone and enter the repo
git clone https://github.com/alekpr/content-creator.git
cd content-creator

# 2. Set up environment
cp backend/.env.example backend/.env
# Edit backend/.env and add your GEMINI_API_KEY

# 3. Start all services
docker-compose up -d

# Services:
# Backend API  →  http://localhost:3001
# Frontend     →  http://localhost:5173
# MongoDB      →  localhost:27017
# Redis        →  localhost:6379
```

### Option B: Local Development

```bash
# 1. Install all workspace dependencies
npm install

# 2. Set up environment
cp backend/.env.example backend/.env
# Edit backend/.env with your GEMINI_API_KEY

# 3. Start MongoDB + Redis (via Docker)
docker-compose up mongo redis -d

# 4. Start backend + frontend concurrently
npm run dev
# Backend  →  http://localhost:3001
# Frontend →  http://localhost:5173
```

---

## 🍎 macOS Local Setup (without Docker)

Install all dependencies natively using [Homebrew](https://brew.sh).

### 1. Install Homebrew (if not installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Install FFmpeg

FFmpeg is required for image resizing, aspect-ratio cropping, and video assembly.

```bash
brew install ffmpeg

# Verify installation
ffmpeg -version
# → ffmpeg version 7.x … built with Apple clang …

# Default install path (used in config)
which ffmpeg   # → /opt/homebrew/bin/ffmpeg
```

> The backend hardcodes `FFMPEG_BIN = '/opt/homebrew/bin/ffmpeg'`. If yours is at a different path (e.g. Intel Mac: `/usr/local/bin/ffmpeg`), update that constant in `backend/src/pipeline/stage2-images.ts` and `backend/src/pipeline/stage6-assembly.ts`.

### 3. Install Redis

Redis is used by BullMQ as the job queue backend.

```bash
brew install redis

# Start Redis as a background service (auto-restart on login)
brew services start redis

# Verify it's running
redis-cli ping   # → PONG

# Stop / restart
brew services stop redis
brew services restart redis
```

Default connection: `redis://localhost:6379`

### 4. Install MongoDB

MongoDB stores all project data, stage results, and generation history.

```bash
# Add the MongoDB tap
brew tap mongodb/brew
brew update

# Install MongoDB Community Edition
brew install mongodb-community@7.0

# Start MongoDB as a background service
brew services start mongodb-community@7.0

# Verify it's running
mongosh --eval "db.adminCommand({ ping: 1 })"
# → { ok: 1 }

# Stop / restart
brew services stop mongodb-community@7.0
brew services restart mongodb-community@7.0
```

Default connection: `mongodb://localhost:27017/ai-video-creator`

### 5. Confirm All Services

```bash
brew services list
# NAME                     STATUS   USER
# mongodb-community@7.0    started  yourname
# redis                    started  yourname
```

### 6. Start the App

```bash
# From project root
npm install
cp backend/.env.example backend/.env
# Edit backend/.env — add GEMINI_API_KEY, verify MONGODB_URI and REDIS_URL
npm run dev
```

---

## ⚙️ Environment Variables

Create `backend/.env` based on `backend/.env.example`:

```env
# Required
GEMINI_API_KEY=your_google_genai_api_key_here

# Database
MONGODB_URI=mongodb://localhost:27017/ai-video-creator
REDIS_URL=redis://localhost:6379

# Server
PORT=3001
FRONTEND_URL=http://localhost:5173
NODE_ENV=development

# File Storage
TEMP_DIR=./temp
OUTPUT_DIR=./output
```

---

## 📜 Scripts

```bash
# Root (runs all workspaces)
npm run dev        # Start backend + frontend concurrently
npm run build      # Build shared → backend → frontend
npm run lint       # Lint all workspaces

# Backend
npm run dev --workspace=backend      # Watch mode (tsx)
npm run build --workspace=backend    # Compile TypeScript → dist/
npm run start --workspace=backend    # Run compiled build

# Frontend
npm run dev --workspace=frontend     # Vite dev server (HMR)
npm run build --workspace=frontend   # Production build
npm run preview --workspace=frontend # Preview production build
```

---

## 📡 API Reference

### Projects
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects` | Create new project (returns cost estimate) |
| `GET` | `/api/projects` | List all projects |
| `GET` | `/api/projects/:id` | Get project with all stage data |
| `DELETE` | `/api/projects/:id` | Delete project and temp files |
| `GET` | `/api/files/:projectId/:filename` | Serve intermediate files (images, clips, audio) |
| `GET` | `/api/projects/:id/download` | Download final MP4 |
| `GET` | `/health` | Health check (DB + Redis status) |

### Stage Actions
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects/:id/stages/:stage/generate` | Trigger generation for a stage |
| `POST` | `/api/projects/:id/stages/:stage/approve` | Approve stage and unlock the next |
| `POST` | `/api/projects/:id/stages/:stage/skip` | Skip an optional stage (e.g. music) |
| `POST` | `/api/projects/:id/stages/:stage/retry` | Retry a failed stage |
| `POST` | `/api/projects/:id/stages/:stage/reset` | Reset stage back to pending |
| `PATCH` | `/api/projects/:id/stages/:stage/prompt` | Edit stage prompt before generating |
| `PATCH` | `/api/projects/:id/stages/:stage/model` | **[New]** Set the AI model for a stage |
| `GET` | `/api/projects/:id/stages/:stage/attempts` | List all generation attempts for a stage |

### Scene-Level Operations
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects/:id/stages/images/scenes/:sceneId/regenerate` | Regenerate a single scene image |
| `POST` | `/api/projects/:id/stages/videos/scenes/:sceneId/regenerate` | Regenerate a single scene video |
| `PATCH` | `/api/projects/:id/stages/storyboard/scenes/:sceneId` | Edit individual storyboard scene fields |
| `PATCH` | `/api/projects/:id/stages/images/scenes/:sceneId/reference` | Upload reference image for a scene |
| `DELETE` | `/api/projects/:id/stages/images/scenes/:sceneId/reference` | Remove reference image for a scene |
| `POST` | `/api/projects/:id/stages/images/scenes/:sceneId/upload` | **[New]** Upload your own image for a scene (bypasses AI) |
| `DELETE` | `/api/projects/:id/stages/images/scenes/:sceneId/upload` | **[New]** Remove manual image upload (reverts to AI) |
| `POST` | `/api/projects/:id/stages/videos/scenes/:sceneId/upload` | **[New]** Upload your own video clip for a scene (bypasses Veo) |
| `DELETE` | `/api/projects/:id/stages/videos/scenes/:sceneId/upload` | **[New]** Remove manual video upload (reverts to Veo) |
| `POST` | `/api/projects/:id/stages/images/scenes/:sceneId/select` | Select a specific version as the active image |
| `POST` | `/api/projects/:id/stages/videos/scenes/:sceneId/select` | Select a specific version as the active video |
| `POST` | `/api/projects/:id/stages/:stage/select` | Select a specific version for voiceover or music |

### WebSocket Events (Socket.io)

| Event | Payload |
|-------|---------|
| `stage:progress` | `{ projectId, stageKey, message, percent, sceneId? }` |
| `stage:status` | `{ projectId, stageKey, status, message? }` |
| `stage:result` | `{ projectId, stageKey, previewUrls, metadata }` |
| `stage:error` | `{ projectId, stageKey, error }` |
| `project:cost` | `{ projectId, costUSD, breakdown }` |
| `project:complete` | `{ projectId, downloadUrl }` |

---

## 📁 Project Structure

```
content-creator/
├── backend/                  # Express API + pipeline
│   ├── src/
│   │   ├── pipeline/         # Stage 1-6 processors
│   │   ├── jobs/             # BullMQ queue + worker
│   │   ├── routes/           # REST API routes
│   │   ├── models/           # Mongoose schemas
│   │   ├── services/         # Gemini API client
│   │   ├── socket/           # Socket.io handlers
│   │   ├── middleware/       # Validation + error handling
│   │   ├── config/           # DB + env config
│   │   └── utils/            # Cost calculator, file helpers
│   └── Dockerfile
├── frontend/                 # React + Vite UI
│   └── src/
│       ├── pages/            # Home + Project pages
│       ├── components/
│       │   └── StagePanel/   # Per-stage review panels
│       │       ├── ModelPicker.tsx              # Per-stage AI model selector
│       │       ├── SceneReferenceUpload.tsx      # Reference image upload grid
│       │       ├── SceneImageSetupPanel.tsx      # Pre-generation setup: upload or AI per scene (images)
│       │       ├── SceneVideoSetupPanel.tsx      # Pre-generation setup: upload or AI per scene (videos)
│       │       ├── VersionBadges.tsx             # v1/v2/… version switcher
│       │       ├── ReviewImages.tsx
│       │       ├── ReviewVideos.tsx
│       │       ├── ReviewAudio.tsx
│       │       └── ReviewStoryboard.tsx
│       ├── hooks/            # useProject, useSocket
│       ├── store/            # Zustand project store
│       └── api/              # API client (client.ts)
├── shared/                   # Shared TypeScript types
│   └── src/index.ts          # StageDoc, SceneImageResult, StageModelConfig, …
├── docs/                     # Architecture documentation
└── docker-compose.yml
```

---

## 🖼️ Per-Stage Model Selection

Before triggering generation, each stage shows a **model picker** dropdown. The selection is saved to the project in MongoDB and used for all subsequent generations of that stage.

```
Storyboard:  Flash Lite  │  Flash (default)  │  Pro
Images:      Flash Lite  │  Flash (default)
Videos:      Veo Lite    │  Veo Fast (default)  │  Veo Full
Voiceover:   Flash TTS (default)  │  Pro TTS
Music:       Lyria Clip (default) │  Lyria Pro
```

---

## 🔁 Version Tracking

Every regeneration saves a **new versioned file** instead of overwriting the previous one:

| Stage | Filename pattern |
|-------|------------------|
| Images | `scene_1_ref_v1.png`, `scene_1_ref_v2.png`, … |
| Videos | `scene_1_v1.mp4`, `scene_1_v2.mp4`, … |
| Voiceover | `voiceover_v1.mp3`, `voiceover_v2.mp3`, … |
| Music | `music_v1.mp3`, `music_v2.mp3`, … |

The version history is stored in `stages.<stageKey>.sceneVersions` in MongoDB. In the review panel, **version badges** (v1, v2, …) appear below each asset — clicking one calls the `/select` API endpoint and updates the active pointer used by the next stage.

---

## 📄 License

MIT
