// ─── Stage Status ────────────────────────────────────────────────────────────

export type StageStatus =
  | 'pending'
  | 'prompt_ready'
  | 'generating'
  | 'review'
  | 'approved'
  | 'failed'
  | 'skipped';

export type StageKey =
  | 'storyboard'
  | 'images'
  | 'videos'
  | 'voiceover'
  | 'music'
  | 'assembly';

// ─── Project Input ────────────────────────────────────────────────────────────

export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'linkedin';
export type Duration = '30s' | '60s' | '3min';
export type Style = 'cinematic' | 'educational' | 'promotional' | 'documentary';
export type Language = 'en' | 'th' | 'ja' | 'zh' | 'ko';
export type Voice = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Aoede';

export interface ProjectInput {
  topic: string;
  platform: Platform;
  duration: Duration;
  style: Style;
  language: Language;
  voice: Voice;
  includeMusic: boolean;
}

// ─── Storyboard ───────────────────────────────────────────────────────────────

export interface StoryboardScene {
  id: number;
  duration: 4 | 6 | 8;
  narration: string;
  visual_prompt: string;
  negative_prompt: string;
  camera_motion: string;
  mood: string;
}

export interface Storyboard {
  title: string;
  hook: string;
  scenes: StoryboardScene[];
  total_scenes: number;
  estimated_duration_seconds: number;
  music_mood: string;
}

// ─── Scene Results ────────────────────────────────────────────────────────────

export interface SceneImagePrompt {
  sceneId: number;
  prompt: string;
  negativePrompt?: string;
}

export interface SceneImageResult {
  sceneId: number;
  imagePath: string;
  filename: string;
  previewUrl: string;
  imageBase64?: string;
}

export interface SceneVideoResult {
  sceneId: number;
  videoPath: string;
  filename: string;
  previewUrl: string;
  durationSeconds: number;
  costUSD: number;
}

export interface VideoGenerationConfig {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: '16:9' | '9:16';
  durationSeconds: '4' | '6' | '8';
  resolution: '720p' | '1080p';
}

// ─── Voiceover / Music ────────────────────────────────────────────────────────

export interface VoiceoverConfig {
  script: string;
  voice: Voice;
  speed: number;
  language: Language;
}

export interface VoiceoverResult {
  audioPath: string;
  filename: string;
  previewUrl: string;
  durationSeconds?: number;
}

export interface MusicResult {
  musicPath: string;
  filename: string;
  previewUrl: string;
  durationSeconds?: number;
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

export interface AssemblyConfig {
  voiceVolume: number;
  musicVolume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  outputFormat: 'mp4';
  outputQuality: 'standard' | 'high';
}

export interface AssemblyResult {
  outputPath: string;
  fileUrl: string;
  durationSeconds: number;
  fileSizeBytes: number;
}

// ─── Generation Attempt ───────────────────────────────────────────────────────

export interface GenerationAttempt {
  attemptNumber: number;
  promptUsed: string | object;
  outputPaths: string[];
  costUSD: number;
  durationMs: number;
  createdAt: Date;
}

// ─── Stage Document ───────────────────────────────────────────────────────────

export interface ReviewData {
  previewUrl?: string;
  previewUrls?: string[];
  metadata?: Record<string, unknown>;
}

export interface StageDoc {
  status: StageStatus;
  prompt: string | object;
  result?: unknown;
  reviewData?: ReviewData;
  attempts: GenerationAttempt[];
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

// ─── Project ──────────────────────────────────────────────────────────────────

export type ProjectStatus = 'in_progress' | 'completed' | 'archived';

export interface ProjectOutput {
  filePath: string;
  fileUrl: string;
  durationSeconds?: number;
  fileSizeBytes?: number;
}

export interface Project {
  _id: string;
  title: string;
  status: ProjectStatus;
  input: ProjectInput;
  stages: {
    storyboard: StageDoc;
    images: StageDoc;
    videos: StageDoc;
    voiceover: StageDoc;
    music: StageDoc;
    assembly: StageDoc;
  };
  output?: ProjectOutput;
  costUSD: number;
  estimatedCostUSD: number;
  actualCostUSD?: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// ─── Socket Events ────────────────────────────────────────────────────────────

export interface StageStatusEvent {
  projectId: string;
  stageKey: StageKey;
  status: StageStatus;
  message: string;
}

export interface StageProgressEvent {
  projectId: string;
  stageKey: StageKey;
  sceneId?: number;
  message: string;
  percent?: number;
}

export interface StageResultEvent {
  projectId: string;
  stageKey: StageKey;
  previewUrls: string[];
  metadata: Record<string, unknown>;
}

export interface StageErrorEvent {
  projectId: string;
  stageKey: StageKey;
  error: string;
}

export interface ProjectCompleteEvent {
  projectId: string;
  downloadUrl: string;
}

// ─── API Response Types ───────────────────────────────────────────────────────

export interface CreateProjectResponse {
  projectId: string;
  status: ProjectStatus;
  stages: Record<StageKey, { status: StageStatus; prompt?: string }>;
  estimatedCostUSD: number;
}

export interface GenerateAcceptedResponse {
  accepted: boolean;
  estimatedSeconds: number;
  wsEvent: string;
}
