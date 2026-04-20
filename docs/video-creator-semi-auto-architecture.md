# AI Video Content Creator — Semi-Auto Pipeline Architecture

> **v3.0** — ระบบ semi-auto ที่ผู้ใช้ review และ approve ทุก stage ก่อนดำเนินการต่อ  
> Stack: Node.js + TypeScript · MongoDB · Google AI APIs · FFmpeg · React + Vite

---

## สารบัญ

1. [Semi-Auto Concept](#1-semi-auto-concept)
2. [Stage State Machine](#2-stage-state-machine)
3. [Full Pipeline Flow](#3-full-pipeline-flow)
4. [MongoDB Schema](#4-mongodb-schema)
5. [API Endpoints](#5-api-endpoints)
6. [Stage 1 — Storyboard](#6-stage-1--storyboard)
7. [Stage 2 — Image Generation](#7-stage-2--image-generation)
8. [Stage 3 — Video Generation](#8-stage-3--video-generation)
9. [Stage 4 — Voiceover](#9-stage-4--voiceover)
10. [Stage 5 — Music](#10-stage-5--music)
11. [Stage 6 — Assembly](#11-stage-6--assembly)
12. [WebSocket Events](#12-websocket-events)
13. [Frontend UX Flow](#13-frontend-ux-flow)
14. [Tech Stack & File Structure](#14-tech-stack--file-structure)
15. [Cost Estimation](#15-cost-estimation)
16. [Development Phases](#16-development-phases)

---

## 1. Semi-Auto Concept

### หลักการ
แทนที่จะรัน pipeline อัตโนมัติตั้งแต่ต้นจนจบ ระบบจะ **หยุดทุก stage** เพื่อให้ผู้ใช้:

1. **Preview prompt** — ดู prompt และ config ที่จะส่งให้ AI ก่อนรัน
2. **Edit prompt** — แก้ไข prompt ได้เต็มที่ก่อน generate
3. **Generate** — กด confirm แล้วระบบรัน (พร้อม progress real-time)
4. **Review result** — ดูผลลัพธ์ของ stage นั้น (image / video / audio / text)
5. **Approve หรือ Re-generate** — ถ้าพอใจกด approve ไป stage ถัดไป ถ้าไม่พอใจแก้ prompt แล้วรันใหม่ได้ทันที

### ข้อดีของ Semi-Auto
- ผู้ใช้ควบคุม quality ทุก stage
- ลดค่าใช้จ่ายจากการ generate ที่ไม่ต้องการ
- เก็บ history ทุก attempt ไว้ใน MongoDB
- กลับมา re-generate stage ไหนก็ได้โดยไม่ต้องเริ่มใหม่ทั้งหมด

---

## 2. Stage State Machine

แต่ละ stage มี status ดังนี้:

```
pending → prompt_ready → generating → review → approved
                ↑                          |
                └──────── re_generate ─────┘
                          (loop กลับได้)

ถ้า error: generating → failed → prompt_ready (retry)
```

### Stage Status Definitions

| Status | ความหมาย | UI Action |
|---|---|---|
| `pending` | รอ stage ก่อนหน้า approve | แสดง lock icon |
| `prompt_ready` | prompt พร้อม รอผู้ใช้ review | แสดง prompt editor + "Generate" button |
| `generating` | AI กำลังทำงาน | แสดง progress spinner + estimated time |
| `review` | ผลลัพธ์พร้อม รอผู้ใช้ตรวจสอบ | แสดง preview + "Approve" / "Re-generate" |
| `approved` | ผ่านแล้ว | แสดง checkmark สีเขียว |
| `failed` | เกิด error | แสดง error message + "Retry" button |

---

## 3. Full Pipeline Flow

```
┌─────────────────────────────────────────────────────────────┐
│  USER INPUT                                                 │
│  topic, platform, duration, style, voice, language         │
└────────────────────────┬────────────────────────────────────┘
                         │ POST /api/projects
                         ▼
                  [MongoDB: Project created]
                  status: "in_progress"
                  stages: [s1..s6] all pending
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  STAGE 1: STORYBOARD                                        │
│                                                             │
│  1a. System auto-generates initial prompt                   │
│  1b. → status: prompt_ready                                 │
│  1c. User reviews prompt in UI (textarea, editable)         │
│  1d. User clicks "Generate Storyboard"                      │
│  1e. → status: generating                                   │
│  1f. Call Gemini 2.5 Flash → JSON storyboard                │
│  1g. → status: review                                       │
│  1h. User sees: scene list, narration, visual_prompt        │
│  1i. User can edit individual scene fields                  │
│  1j. User clicks "Approve" → status: approved               │
│       OR clicks "Re-generate" → back to prompt_ready        │
└─────────────────────────────────────────────────────────────┘
                         │ approved
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  STAGE 2: IMAGE GENERATION (per scene)                      │
│                                                             │
│  2a. Auto-build prompts จาก approved storyboard             │
│  2b. → status: prompt_ready                                 │
│  2c. User เห็น prompt ของแต่ละ scene (แก้ได้ทีละ scene)    │
│  2d. User clicks "Generate All Images"                      │
│  2e. → status: generating (parallel per scene)              │
│  2f. Call Gemini 2.5 Flash Image × N scenes                 │
│  2g. → status: review                                       │
│  2h. User เห็น image gallery ของทุก scene                  │
│  2i. Re-generate เฉพาะ scene ที่ไม่พอใจได้                 │
│  2j. Approve ทั้งหมด → status: approved                    │
└─────────────────────────────────────────────────────────────┘
                         │ approved
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  STAGE 3: VIDEO GENERATION (per scene, async + polling)     │
│                                                             │
│  3a. Auto-build video prompts จาก storyboard + images       │
│  3b. → status: prompt_ready                                 │
│  3c. User review prompt + config (duration, aspect ratio)   │
│  3d. User clicks "Generate All Videos"                      │
│  3e. → status: generating (Veo 3.1 async polling)           │
│  3f. แสดง estimated time และ polling status per scene       │
│  3g. → status: review                                       │
│  3h. User เล่น video preview แต่ละ scene ได้               │
│  3i. Re-generate เฉพาะ scene ได้                           │
│  3j. Approve ทั้งหมด → status: approved                    │
└─────────────────────────────────────────────────────────────┘
                         │ approved
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  STAGE 4: VOICEOVER                                         │
│                                                             │
│  4a. Compile narration text จาก approved scenes             │
│  4b. → status: prompt_ready                                 │
│  4c. User เห็น full script + เลือก voice / speed           │
│  4d. User clicks "Generate Voiceover"                       │
│  4e. Call Gemini TTS → audio file                           │
│  4f. → status: review                                       │
│  4g. User ฟัง audio preview ได้                            │
│  4h. Approve หรือ re-generate (เปลี่ยน voice / แก้ script) │
└─────────────────────────────────────────────────────────────┘
                         │ approved
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  STAGE 5: MUSIC (optional)                                  │
│                                                             │
│  5a. Suggest music mood จาก storyboard                      │
│  5b. → status: prompt_ready                                 │
│  5c. User แก้ mood / genre ได้                             │
│  5d. User clicks "Generate Music" หรือ "Skip"              │
│  5e. Call Lyria 3 Clip → 30s audio                          │
│  5f. User preview + approve / re-generate / skip            │
└─────────────────────────────────────────────────────────────┘
                         │ approved / skipped
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  STAGE 6: ASSEMBLY                                          │
│                                                             │
│  6a. Preview config: volume mix, fade, output format        │
│  6b. User adjust mixing settings                            │
│  6c. User clicks "Assemble Final Video"                     │
│  6d. FFmpeg: concat clips + mix audio → .mp4               │
│  6e. → status: review                                       │
│  6f. User preview final video                               │
│  6g. Approve → Project complete + download link             │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
                [MongoDB: Project status = "completed"]
                [File: /output/{projectId}.mp4]
```

---

## 4. MongoDB Schema

### Collection: `projects`

```typescript
interface Project {
  _id: ObjectId;
  userId?: string;            // ถ้ามี auth
  title: string;
  status: 'in_progress' | 'completed' | 'archived';

  // User input
  input: {
    topic: string;
    platform: 'youtube' | 'tiktok';
    duration: '30s' | '60s' | '3min';
    style: 'educational' | 'storytelling' | 'motivational';
    language: 'th' | 'en';
    voice: 'female' | 'male';
    hasMusic: boolean;
  };

  // Stage tracking
  stages: {
    storyboard: StageDoc;
    images:     StageDoc;
    videos:     StageDoc;
    voiceover:  StageDoc;
    music:      StageDoc;
    assembly:   StageDoc;
  };

  // Final output
  output?: {
    filePath: string;
    fileUrl: string;
    durationSeconds: number;
    fileSizeBytes: number;
  };

  // Cost tracking
  costUSD: number;

  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}
```

### Type: `StageDoc` (embed ใน Project)

```typescript
interface StageDoc {
  status: 'pending' | 'prompt_ready' | 'generating' | 'review' | 'approved' | 'failed' | 'skipped';

  // Prompt ที่ใช้ในการ generate (user-editable)
  prompt: string | object;      // text หรือ JSON config

  // ผลลัพธ์ที่ได้ (หลัง generate)
  result?: any;                 // storyboard JSON / image paths / video paths / audio path

  // ข้อมูลสำหรับ review
  reviewData?: {
    previewUrl?: string;        // URL สำหรับ preview ใน UI
    previewUrls?: string[];     // กรณี multi-scene
    metadata?: object;          // duration, size, etc.
  };

  // Generation attempts (ทุกครั้งที่ generate เก็บไว้)
  attempts: GenerationAttempt[];

  // Error ถ้า failed
  error?: string;

  startedAt?: Date;
  completedAt?: Date;
}
```

### Collection: `generation_logs`

```typescript
interface GenerationLog {
  _id: ObjectId;
  projectId: ObjectId;
  stageKey: 'storyboard' | 'images' | 'videos' | 'voiceover' | 'music' | 'assembly';
  attemptNumber: number;

  // Input
  promptUsed: string | object;
  modelUsed: string;           // e.g. "veo-3.1-fast-generate-preview"
  configUsed: object;          // aspect ratio, duration, etc.

  // Output
  status: 'success' | 'failed';
  outputPaths?: string[];      // file paths ที่ได้
  error?: string;

  // Performance
  durationMs: number;
  costUSD: number;

  createdAt: Date;
}
```

### Type: `GenerationAttempt` (embed ใน StageDoc)

```typescript
interface GenerationAttempt {
  attemptNumber: number;
  promptUsed: string | object;
  outputPaths: string[];
  costUSD: number;
  durationMs: number;
  createdAt: Date;
}
```

### Index แนะนำ

```typescript
// projects collection
db.projects.createIndex({ userId: 1, createdAt: -1 });
db.projects.createIndex({ status: 1 });

// generation_logs collection
db.generation_logs.createIndex({ projectId: 1, stageKey: 1 });
db.generation_logs.createIndex({ createdAt: -1 });
```

---

## 5. API Endpoints

### Projects

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/projects` | สร้าง project ใหม่ + generate initial prompts |
| `GET` | `/api/projects` | ดู project ทั้งหมด |
| `GET` | `/api/projects/:id` | ดู project + stage status ทั้งหมด |
| `DELETE` | `/api/projects/:id` | ลบ project |

### Stage Control

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/projects/:id/stages/:stage` | ดู stage detail + prompt + result |
| `PATCH` | `/api/projects/:id/stages/:stage/prompt` | แก้ไข prompt |
| `POST` | `/api/projects/:id/stages/:stage/generate` | เริ่ม generate |
| `POST` | `/api/projects/:id/stages/:stage/approve` | approve และ unlock stage ถัดไป |
| `POST` | `/api/projects/:id/stages/:stage/skip` | skip stage (เฉพาะ music) |
| `GET` | `/api/projects/:id/stages/:stage/attempts` | ดู generation history |

### Files

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/files/:projectId/:filename` | serve temp files (image/video/audio) |
| `GET` | `/api/projects/:id/download` | download final .mp4 |

### Request / Response Examples

#### POST /api/projects

```json
// Request
{
  "topic": "5 วิธีออมเงินสำหรับคนเงินเดือน 15,000",
  "platform": "youtube",
  "duration": "60s",
  "style": "educational",
  "language": "th",
  "voice": "female",
  "hasMusic": true
}

// Response
{
  "projectId": "683a1f...",
  "status": "in_progress",
  "stages": {
    "storyboard": { "status": "prompt_ready", "prompt": "..." },
    "images":     { "status": "pending" },
    "videos":     { "status": "pending" },
    "voiceover":  { "status": "pending" },
    "music":      { "status": "pending" },
    "assembly":   { "status": "pending" }
  },
  "estimatedCostUSD": 6.35
}
```

#### POST /api/projects/:id/stages/storyboard/generate

```json
// Request (ส่ง prompt ที่ user อาจแก้แล้ว)
{
  "prompt": "สร้าง storyboard สำหรับ video เรื่อง '5 วิธีออมเงิน...' ..."
}

// Response (immediate — generation is async via WebSocket)
{
  "accepted": true,
  "estimatedSeconds": 10,
  "wsEvent": "stage:storyboard:progress"
}
```

#### PATCH /api/projects/:id/stages/images/prompt

```json
// Request — แก้ prompt ของ scene เดียว
{
  "sceneId": 2,
  "visualPrompt": "close-up of coins stacking in a glass jar, soft morning light, cinematic",
  "negativePrompt": "text, watermark, blurry, cartoon"
}
```

---

## 6. Stage 1 — Storyboard

**Model:** `gemini-2.5-flash`  
**MongoDB field:** `stages.storyboard`

### Initial prompt builder (auto-generated)

```typescript
// src/pipeline/stage1-storyboard.ts
export function buildStoryboardPrompt(input: ProjectInput): string {
  const sceneCount = durationToSceneCount(input.duration);

  return `
คุณเป็น video director และ scriptwriter มืออาชีพ
สร้าง video storyboard แบบ JSON เท่านั้น ห้าม markdown หรือ text นอก JSON

Platform: ${input.platform} (${input.platform === 'tiktok' ? 'hook ใน 3 วินาทีแรก, กระชับ' : 'hook ใน 15 วินาที, อธิบายละเอียดได้'})
Language: ${input.language}
Style: ${input.style}
Target scenes: ${sceneCount} scenes (duration แต่ละ scene = 4, 6 หรือ 8 วินาที)

Topic: "${input.topic}"

JSON format ที่ต้องการ:
{
  "title": "string",
  "hook": "string",
  "scenes": [
    {
      "id": 1,
      "duration": 8,
      "narration": "string (ภาษา ${input.language})",
      "visual_prompt": "string (English, cinematic description for Veo)",
      "negative_prompt": "string (what NOT to show)",
      "camera_motion": "string",
      "mood": "string"
    }
  ],
  "total_scenes": ${sceneCount},
  "estimated_duration_seconds": number,
  "music_mood": "string"
}
  `.trim();
}
```

### Service

```typescript
export async function generateStoryboard(
  projectId: string,
  prompt: string,
  onProgress: (msg: string) => void
): Promise<StoryboardResult> {
  onProgress('Calling Gemini 2.5 Flash...');

  const response = await geminiClient.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' }
  });

  const raw = response.candidates[0].content.parts[0].text;
  const storyboard = JSON.parse(raw.replace(/```json|```/g, '').trim());

  // Save to MongoDB
  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.storyboard.status': 'review',
    'stages.storyboard.result': storyboard,
    'stages.storyboard.reviewData': {
      metadata: {
        sceneCount: storyboard.scenes.length,
        estimatedDuration: storyboard.estimated_duration_seconds
      }
    }
  });

  return storyboard;
}
```

---

## 7. Stage 2 — Image Generation

**Model:** `gemini-2.5-flash-image`  
**MongoDB field:** `stages.images`

### Prompt builder

```typescript
export function buildImagePrompts(storyboard: Storyboard): SceneImagePrompt[] {
  return storyboard.scenes.map(scene => ({
    sceneId: scene.id,
    prompt: `${scene.visual_prompt}, ${scene.mood}, cinematic, high quality, 16:9`,
    negativePrompt: scene.negative_prompt
  }));
}
```

### Service — generate per scene, save paths

```typescript
export async function generateImages(
  projectId: string,
  scenePrompts: SceneImagePrompt[],
  onProgress: (msg: string) => void
): Promise<SceneImageResult[]> {
  const results: SceneImageResult[] = [];

  for (const sp of scenePrompts) {
    onProgress(`Generating image for scene ${sp.sceneId}/${scenePrompts.length}...`);

    const response = await geminiImageClient.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [{ parts: [{ text: sp.prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] }
    });

    const imageBase64 = response.candidates[0].content.parts[0].inlineData.data;
    const imagePath = `./temp/${projectId}/scene_${sp.sceneId}_ref.png`;

    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    fs.writeFileSync(imagePath, Buffer.from(imageBase64, 'base64'));

    results.push({
      sceneId: sp.sceneId,
      imagePath,
      previewUrl: `/api/files/${projectId}/scene_${sp.sceneId}_ref.png`,
      imageBase64
    });
  }

  // Update MongoDB
  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.images.status': 'review',
    'stages.images.result': results.map(r => ({ sceneId: r.sceneId, imagePath: r.imagePath })),
    'stages.images.reviewData.previewUrls': results.map(r => r.previewUrl)
  });

  return results;
}
```

### Re-generate single scene

```typescript
export async function regenerateSceneImage(
  projectId: string,
  sceneId: number,
  newPrompt: string
): Promise<SceneImageResult> {
  // Generate new image
  const result = await generateSingleImage(projectId, sceneId, newPrompt);

  // Update only that scene in MongoDB (partial update)
  await ProjectModel.findOneAndUpdate(
    { _id: projectId },
    {
      $set: {
        [`stages.images.result.${sceneId - 1}`]: {
          sceneId,
          imagePath: result.imagePath
        }
      }
    }
  );

  return result;
}
```

---

## 8. Stage 3 — Video Generation

**Model:** `veo-3.1-fast-generate-preview`  
**MongoDB field:** `stages.videos`

### Config builder

```typescript
export function buildVideoConfig(
  scene: StoryboardScene,
  platform: string
): VideoGenerationConfig {
  return {
    prompt: `${scene.visual_prompt}. Camera: ${scene.camera_motion}. Mood: ${scene.mood}. Cinematic.`,
    negativePrompt: scene.negative_prompt,
    aspectRatio: platform === 'tiktok' ? '9:16' : '16:9',
    durationSeconds: String(scene.duration) as '4' | '6' | '8',
    resolution: '720p'
  };
}
```

### Service — async polling per scene

```typescript
export async function generateVideos(
  projectId: string,
  scenes: StoryboardScene[],
  sceneImages: SceneImageResult[],
  platform: string,
  onProgress: (sceneId: number, status: string) => void
): Promise<SceneVideoResult[]> {
  const results: SceneVideoResult[] = [];

  for (const scene of scenes) {
    const image = sceneImages.find(img => img.sceneId === scene.id);
    const config = buildVideoConfig(scene, platform);

    onProgress(scene.id, 'submitting');

    // Submit job to Veo
    let operation = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: config.prompt,
      image: { imageBytes: image.imageBase64, mimeType: 'image/png' },
      config: {
        aspectRatio: config.aspectRatio,
        durationSeconds: config.durationSeconds,
        resolution: config.resolution,
        negativePrompt: config.negativePrompt
      }
    });

    // Polling loop
    while (!operation.done) {
      onProgress(scene.id, 'polling');
      await sleep(10000);
      operation = await ai.operations.getVideosOperation({ operation });
    }

    // Download video
    const videoPath = `./temp/${projectId}/scene_${scene.id}.mp4`;
    await ai.files.download({
      file: operation.response.generatedVideos[0].video,
      downloadPath: videoPath
    });

    onProgress(scene.id, 'done');

    results.push({
      sceneId: scene.id,
      videoPath,
      previewUrl: `/api/files/${projectId}/scene_${scene.id}.mp4`,
      durationSeconds: scene.duration,
      costUSD: scene.duration * 0.10
    });
  }

  // Update MongoDB
  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.videos.status': 'review',
    'stages.videos.result': results.map(r => ({
      sceneId: r.sceneId,
      videoPath: r.videoPath,
      durationSeconds: r.durationSeconds
    })),
    'stages.videos.reviewData.previewUrls': results.map(r => r.previewUrl)
  });

  return results;
}
```

---

## 9. Stage 4 — Voiceover

**Model:** `gemini-2.5-flash-preview-tts`  
**MongoDB field:** `stages.voiceover`

### Script builder

```typescript
export function buildVoiceoverScript(storyboard: Storyboard): VoiceoverConfig {
  // รวม narration ทุก scene พร้อม pause marker
  const fullScript = storyboard.scenes
    .map(s => s.narration)
    .join('\n\n');  // line break = natural pause

  return {
    script: fullScript,
    voice: 'Aoede',       // female Thai-capable
    speed: 1.0,
    language: 'th'
  };
}
```

### Service

```typescript
export async function generateVoiceover(
  projectId: string,
  config: VoiceoverConfig,
  onProgress: (msg: string) => void
): Promise<VoiceoverResult> {
  onProgress('Generating voiceover...');

  const voiceMap: Record<string, string> = {
    female: 'Aoede',
    male: 'Charon'
  };

  const response = await fetch(
    `${GEMINI_BASE}/models/gemini-2.5-flash-preview-tts:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: config.script }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceMap[config.voice] }
            }
          }
        }
      })
    }
  );

  const data = await response.json();
  const audioBase64 = data.candidates[0].content.parts[0].inlineData.data;
  const audioPath = `./temp/${projectId}/voiceover.mp3`;
  fs.writeFileSync(audioPath, Buffer.from(audioBase64, 'base64'));

  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.voiceover.status': 'review',
    'stages.voiceover.result': { audioPath },
    'stages.voiceover.reviewData.previewUrl': `/api/files/${projectId}/voiceover.mp3`
  });

  return { audioPath, previewUrl: `/api/files/${projectId}/voiceover.mp3` };
}
```

---

## 10. Stage 5 — Music

**Model:** `lyria-3-clip-preview`  
**MongoDB field:** `stages.music`

### Service

```typescript
export async function generateMusic(
  projectId: string,
  musicMood: string,
  onProgress: (msg: string) => void
): Promise<MusicResult> {
  onProgress('Generating background music...');

  const response = await fetch(
    `${GEMINI_BASE}/models/lyria-3-clip-preview:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `Background music: ${musicMood}. No lyrics. Loopable. 30 seconds.` }]
        }]
      })
    }
  );

  const data = await response.json();
  const audioBase64 = data.candidates[0].content.parts[0].inlineData.data;
  const musicPath = `./temp/${projectId}/music.mp3`;
  fs.writeFileSync(musicPath, Buffer.from(audioBase64, 'base64'));

  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.music.status': 'review',
    'stages.music.result': { musicPath },
    'stages.music.reviewData.previewUrl': `/api/files/${projectId}/music.mp3`
  });

  return { musicPath, previewUrl: `/api/files/${projectId}/music.mp3` };
}
```

---

## 11. Stage 6 — Assembly

**Tool:** FFmpeg  
**MongoDB field:** `stages.assembly`

### Config (user-adjustable ก่อน assemble)

```typescript
interface AssemblyConfig {
  voiceVolume: number;       // 0.0 - 1.0 (default: 1.0)
  musicVolume: number;       // 0.0 - 1.0 (default: 0.2)
  fadeInSeconds: number;     // default: 0.5
  fadeOutSeconds: number;    // default: 1.0
  outputFormat: 'mp4';
  outputQuality: 'standard' | 'high';  // crf 23 | crf 18
}
```

### Service

```typescript
import ffmpeg from 'fluent-ffmpeg';

export async function assembleVideo(
  projectId: string,
  videoPaths: string[],
  voicePath: string,
  musicPath: string | null,
  config: AssemblyConfig,
  onProgress: (percent: number) => void
): Promise<AssemblyResult> {
  const tempDir = `./temp/${projectId}`;
  const outputPath = `./output/${projectId}.mp4`;

  // Step 1: Create concat file
  const fileList = videoPaths.map(p => `file '${path.resolve(p)}'`).join('\n');
  fs.writeFileSync(`${tempDir}/filelist.txt`, fileList);

  // Step 2: Concat video clips
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(`${tempDir}/filelist.txt`)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .output(`${tempDir}/video_concat.mp4`)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  // Step 3: Mix video + audio
  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg().input(`${tempDir}/video_concat.mp4`);

    if (musicPath) {
      cmd
        .input(voicePath)
        .input(musicPath)
        .complexFilter([
          `[1:a]volume=${config.voiceVolume}[voice]`,
          `[2:a]volume=${config.musicVolume}[music]`,
          `[voice][music]amix=inputs=2:duration=first[aout]`
        ])
        .outputOptions(['-map 0:v', '-map [aout]', '-c:v copy', '-c:a aac', '-shortest']);
    } else {
      cmd
        .input(voicePath)
        .outputOptions([`-filter:a volume=${config.voiceVolume}`, '-c:v copy', '-c:a aac', '-shortest']);
    }

    cmd
      .output(outputPath)
      .on('progress', p => onProgress(Math.round(p.percent ?? 0)))
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  const stats = fs.statSync(outputPath);

  await ProjectModel.findByIdAndUpdate(projectId, {
    status: 'completed',
    'stages.assembly.status': 'approved',
    output: {
      filePath: outputPath,
      fileUrl: `/api/projects/${projectId}/download`,
      fileSizeBytes: stats.size
    },
    completedAt: new Date()
  });

  return { outputPath, fileUrl: `/api/projects/${projectId}/download` };
}
```

---

## 12. WebSocket Events

ใช้ **Socket.io** ส่ง real-time updates ทุก state change

### Server → Client Events

```typescript
// Stage status changed
socket.emit('stage:status', {
  projectId: string,
  stageKey: string,
  status: StageStatus,
  message: string
});

// Generation progress
socket.emit('stage:progress', {
  projectId: string,
  stageKey: string,
  sceneId?: number,
  message: string,
  percent?: number
});

// Stage result ready (review)
socket.emit('stage:result', {
  projectId: string,
  stageKey: string,
  previewUrls: string[],
  metadata: object
});

// Error
socket.emit('stage:error', {
  projectId: string,
  stageKey: string,
  error: string
});

// Project complete
socket.emit('project:complete', {
  projectId: string,
  downloadUrl: string
});
```

### Client → Server Events

```typescript
// Join project room
socket.emit('project:join', { projectId: string });

// Leave project room
socket.emit('project:leave', { projectId: string });
```

---

## 13. Frontend UX Flow

### หน้า Project Dashboard

```
[New Project] button
  → Modal: input form (topic, platform, duration, style, voice)
  → POST /api/projects
  → Redirect to /projects/{id}

Project page layout:
┌────────────────────────────────────────────┐
│ Project title               [Cost: $X.XX]  │
│ Status: in_progress                        │
├────────────────────────────────────────────┤
│                                            │
│  Stage 1: Storyboard    [prompt_ready] ●   │
│  Stage 2: Images        [pending]      ○   │
│  Stage 3: Videos        [pending]      ○   │
│  Stage 4: Voiceover     [pending]      ○   │
│  Stage 5: Music         [pending]      ○   │
│  Stage 6: Assembly      [pending]      ○   │
│                                            │
└────────────────────────────────────────────┘
```

### Stage Panel — prompt_ready state

```
┌── Stage 1: Storyboard ─────────────────────┐
│ Status: Ready to generate                  │
│                                            │
│ Prompt (แก้ได้):                           │
│ ┌──────────────────────────────────────┐   │
│ │ คุณเป็น video director...            │   │
│ │ Topic: "5 วิธีออมเงิน..."           │   │
│ │ [textarea — full editable]           │   │
│ └──────────────────────────────────────┘   │
│                                            │
│ Estimated cost: $0.001                     │
│                                            │
│ [Reset Prompt]      [Generate Storyboard →]│
└────────────────────────────────────────────┘
```

### Stage Panel — review state (Storyboard)

```
┌── Stage 1: Storyboard ─────────────────────┐
│ Status: Review results                     │
│                                            │
│ Generated: 6 scenes · ~58 seconds          │
│                                            │
│ Scene 1 (8s) [edit ✎]                     │
│ Narration: "คุณเคยสงสัยไหม..."            │
│ Visual: "close-up of a piggy bank..."      │
│                                            │
│ Scene 2 (6s) [edit ✎]                     │
│ ...                                        │
│                                            │
│ [Re-generate]       [Approve & Continue →] │
└────────────────────────────────────────────┘
```

### Stage Panel — review state (Videos)

```
┌── Stage 3: Video Clips ────────────────────┐
│ Status: Review results                     │
│                                            │
│ [Scene 1] [Scene 2] [Scene 3] [Scene 4]   │
│ ┌──────────────────────────────────────┐   │
│ │  [video player]  ▶ scene_1.mp4       │   │
│ │  Duration: 8s                        │   │
│ └──────────────────────────────────────┘   │
│ [Re-generate this scene]                   │
│                                            │
│ All scenes: ✓ ✓ ✓ ✓                       │
│                                            │
│ [Re-generate All]   [Approve & Continue →] │
└────────────────────────────────────────────┘
```

---

## 14. Tech Stack & File Structure

### Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS |
| Language | TypeScript 5.x (strict mode) |
| Framework | Express.js 5 |
| Database | MongoDB 7 + Mongoose 8 |
| Google AI SDK | `@google/genai` latest |
| Video processing | FFmpeg + `fluent-ffmpeg` |
| Real-time | Socket.io 4 |
| Job queue | BullMQ + Redis (สำหรับ Veo async jobs) |
| Validation | Zod |
| Frontend | React 18 + Vite + Tailwind CSS |
| File serving | Express static / Multer |
| Deploy (backend) | Railway (Docker) |
| Deploy (frontend) | Vercel |

### File Structure

```
ai-video-creator/
├── backend/
│   ├── src/
│   │   ├── models/
│   │   │   ├── Project.model.ts       ← Mongoose schema
│   │   │   └── GenerationLog.model.ts
│   │   ├── pipeline/
│   │   │   ├── stage1-storyboard.ts
│   │   │   ├── stage2-images.ts
│   │   │   ├── stage3-videos.ts
│   │   │   ├── stage4-voiceover.ts
│   │   │   ├── stage5-music.ts
│   │   │   └── stage6-assembly.ts
│   │   ├── routes/
│   │   │   ├── projects.router.ts     ← CRUD projects
│   │   │   └── stages.router.ts       ← stage control endpoints
│   │   ├── services/
│   │   │   ├── gemini.service.ts      ← Gemini API client
│   │   │   ├── veo.service.ts         ← Veo polling + download
│   │   │   ├── tts.service.ts
│   │   │   ├── lyria.service.ts
│   │   │   └── ffmpeg.service.ts
│   │   ├── socket/
│   │   │   └── socket.handler.ts      ← Socket.io event handlers
│   │   ├── jobs/
│   │   │   └── video.queue.ts         ← BullMQ job definitions
│   │   ├── middleware/
│   │   │   ├── error.middleware.ts
│   │   │   └── validate.middleware.ts
│   │   ├── utils/
│   │   │   ├── sleep.ts
│   │   │   ├── cost.calculator.ts
│   │   │   └── file.helper.ts
│   │   ├── types/
│   │   │   └── pipeline.types.ts
│   │   ├── config/
│   │   │   └── env.ts                 ← typed env vars (Zod)
│   │   ├── app.ts
│   │   └── server.ts
│   ├── temp/                          ← temp files (gitignored)
│   ├── output/                        ← final .mp4 files
│   ├── .env
│   ├── .env.example
│   ├── Dockerfile
│   ├── tsconfig.json
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx               ← project list
│   │   │   └── Project.tsx            ← stage-by-stage UI
│   │   ├── components/
│   │   │   ├── StagePanel/
│   │   │   │   ├── StagePanel.tsx     ← wrapper per stage
│   │   │   │   ├── PromptEditor.tsx   ← editable textarea
│   │   │   │   ├── GenerateButton.tsx
│   │   │   │   ├── ReviewStoryboard.tsx
│   │   │   │   ├── ReviewImages.tsx
│   │   │   │   ├── ReviewVideos.tsx
│   │   │   │   ├── ReviewAudio.tsx
│   │   │   │   └── ReviewAssembly.tsx
│   │   │   ├── CostBadge.tsx
│   │   │   └── StatusBadge.tsx
│   │   ├── hooks/
│   │   │   ├── useProject.ts          ← fetch project + polling
│   │   │   └── useSocket.ts           ← Socket.io connection
│   │   ├── api/
│   │   │   └── client.ts              ← typed API functions
│   │   └── App.tsx
│   └── package.json
│
├── docker-compose.yml                 ← MongoDB + Redis + Backend
└── README.md
```

### Environment Variables

```bash
# backend/.env
GEMINI_API_KEY=your_paid_tier_key
MONGODB_URI=mongodb://localhost:27017/ai-video-creator
REDIS_URL=redis://localhost:6379
PORT=3001
FRONTEND_URL=http://localhost:5173
TEMP_DIR=./temp
OUTPUT_DIR=./output
```

### Dockerfile (backend)

```dockerfile
FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["node", "dist/server.js"]
```

---

## 15. Cost Estimation

### ต้นทุนต่อ video (60 วินาที, 8 scenes, มี music)

| Stage | Model | Unit | ราคา/unit | รวม (USD) |
|---|---|---|---|---|
| Storyboard | Gemini 2.5 Flash | ~2K tokens | $0.30/1M in | ~$0.001 |
| Images | Gemini 2.5 Flash Image | 8 images | $0.039/img | ~$0.31 |
| Videos | Veo 3.1 Fast 720p | ~60 วินาที | $0.10/s | ~$6.00 |
| Voiceover | Gemini TTS Flash | ~500 tokens | $0.50/1M in | ~$0.001 |
| Music | Lyria 3 Clip | 1 clip | $0.04/clip | ~$0.04 |
| **รวม** | | | | **~$6.35** |

### ทางเลือกประหยัดต้นทุน

| Option | Model | ราคา/s | ประหยัด |
|---|---|---|---|
| Standard | Veo 3.1 Fast | $0.10/s | — |
| ประหยัด | Veo 3.1 Lite | $0.05/s | 50% |
| สูงสุด | Veo 3.1 Standard | $0.40/s | (premium) |

> ใน semi-auto mode ผู้ใช้เห็น estimated cost ก่อน generate ทุก stage

---

## 16. Development Phases

### Phase 1 — Backend Core (2 สัปดาห์)

- [ ] Setup Node.js + TypeScript + Express + MongoDB + Mongoose
- [ ] สร้าง Project model + GenerationLog model
- [ ] API: CRUD projects
- [ ] Pipeline Stage 1: storyboard + prompt builder
- [ ] API: stage generate / approve endpoints
- [ ] Socket.io: real-time status events
- [ ] Test flow: input → storyboard → approve

### Phase 2 — Full Pipeline (2 สัปดาห์)

- [ ] Stage 2: image generation + per-scene re-generate
- [ ] Stage 3: Veo 3.1 + async polling + BullMQ job
- [ ] Stage 4: TTS voiceover
- [ ] Stage 5: Lyria music + skip option
- [ ] Stage 6: FFmpeg assembly + progress events
- [ ] File serving endpoint
- [ ] Cost tracking per stage ใน MongoDB

### Phase 3 — Frontend (1-2 สัปดาห์)

- [ ] Project list page
- [ ] Stage panel component (status-driven)
- [ ] Prompt editor (editable textarea + reset)
- [ ] Image gallery review (re-generate single scene)
- [ ] Video player review per scene
- [ ] Audio player (voiceover + music)
- [ ] Assembly config (volume sliders)
- [ ] Real-time Socket.io integration
- [ ] Cost badge per stage
- [ ] Download button

### Phase 4 — Production (1 สัปดาห์)

- [ ] Error handling + retry logic ทุก stage
- [ ] Cleanup temp files หลัง project complete
- [ ] Rate limit handling (Veo)
- [ ] Docker + docker-compose setup
- [ ] Deploy Railway (backend) + Vercel (frontend)
- [ ] MongoDB Atlas setup

---

*อัปเดตล่าสุด: เมษายน 2026*  
*Version: 3.0.0 — Semi-Auto Pipeline*  
*Stack: Node.js · TypeScript · MongoDB · Google AI APIs*
