# 🎬 Content Creator — AI Video Generation Platform

A **semi-automatic AI video generation platform** that transforms a simple topic into a fully assembled video. The workflow gives creators full control through a human-in-the-loop design: review and approve each stage before moving on, edit prompts, regenerate individual scenes, and track generation costs in real time.

---

## ✨ Features

- **6-Stage AI Pipeline** — Storyboard → Images → Videos → Voiceover → Music → Assembly
- **Human-in-the-Loop** — Review and approve every stage; edit prompts and regenerate at any step
- **Real-time Progress** — WebSocket events stream progress percentage and status updates to the UI
- **Cost Tracking** — Estimated cost shown before generation; actual cost tracked after each stage
- **Multi-Platform Support** — YouTube (16:9), TikTok/Instagram (9:16), LinkedIn
- **Multi-Language** — English, Thai, Japanese, Chinese, Korean
- **Voice Selection** — 5 AI voices: Puck, Charon, Kore, Fenrir, Aoede
- **Optional Background Music** — Mood-driven AI music generation, mixable with voiceover
- **Scene-Level Regeneration** — Regenerate individual scenes without restarting the whole pipeline
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
| `gemini-2.5-flash` | Stage 1 | Storyboard generation (JSON output) |
| `gemini-2.5-flash` | Stage 2 | Image generation (PNG per scene) |
| `veo-3.1-fast-generate-preview` | Stage 3 | Video generation (async + polling) |
| `gemini-2.5-flash-preview-tts` | Stage 4 | Text-to-speech voiceover |
| `lyria-3-clip-preview` | Stage 5 | Background music generation |

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
- **Model**: `gemini-2.5-flash` (image generation)  
- One 16:9 PNG generated per scene, all in parallel  
- **Cost**: ~$0.039 per image

### Stage 3 — Videos
- **Model**: `veo-3.1-fast-generate-preview` (async operation)  
- Each scene submitted as a BullMQ job; worker polls until complete  
- Aspect ratio: 16:9 (YouTube/LinkedIn) or 9:16 (TikTok/Instagram)  
- **Cost**: ~$0.10 per second of video

### Stage 4 — Voiceover
- **Model**: `gemini-2.5-flash-preview-tts`  
- All scene narrations concatenated into a single script → MP3  
- 5 voice options, adjustable speed  
- **Cost**: ~$0.001 per generation

### Stage 5 — Music *(Optional)*
- **Model**: `lyria-3-clip-preview`  
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
- [Docker & Docker Compose](https://docs.docker.com/get-docker/)
- [Google GenAI API Key](https://aistudio.google.com/app/apikey) (with Gemini, Veo, Lyria access)

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

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects` | Create new project (returns cost estimate) |
| `GET` | `/api/projects` | List all projects |
| `GET` | `/api/projects/:id` | Get project with all stage data |
| `DELETE` | `/api/projects/:id` | Delete project and temp files |
| `PATCH` | `/api/projects/:id/stages/:stage` | Update stage (edit prompt / approve / regenerate) |
| `GET` | `/api/files/:projectId/:filename` | Serve intermediate files (images, clips, audio) |
| `GET` | `/api/projects/:id/download` | Download final MP4 |
| `GET` | `/health` | Health check (DB + Redis status) |

### WebSocket Events (Socket.io)

| Event | Payload |
|-------|---------|
| `stageProgress` | `{ projectId, stageKey, message, percent }` |
| `stageStatus` | `{ projectId, stageKey, status }` |
| `stageError` | `{ projectId, stageKey, error }` |
| `projectComplete` | `{ projectId, downloadUrl }` |

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
│       ├── components/       # StagePanel per pipeline step
│       ├── hooks/            # useProject, useSocket
│       ├── store/            # Zustand project store
│       └── api/              # API client
├── shared/                   # Shared TypeScript types
├── docs/                     # Architecture documentation
└── docker-compose.yml
```

---

## 📄 License

MIT
