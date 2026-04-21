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

// ─── Stage Model Config ───────────────────────────────────────────────────────

export type StoryboardModel = 'gemini-2.5-flash-lite' | 'gemini-2.5-flash' | 'gemini-2.5-pro';
export type ImageModel     = 'gemini-2.5-flash-image' | 'gemini-3.1-flash-image-preview';
export type VideoModel     = 'veo-3.1-lite-generate-preview' | 'veo-3.1-fast-generate-preview' | 'veo-3.1-generate-preview';
export type VoiceoverModel = 'gemini-2.5-flash-preview-tts' | 'gemini-2.5-pro-preview-tts';
export type MusicModel     = 'lyria-3-clip-preview' | 'lyria-3-pro-preview';

export interface StageModelConfig {
  storyboard: StoryboardModel;
  images:     ImageModel;
  videos:     VideoModel;
  voiceover:  VoiceoverModel;
  music:      MusicModel;
}

export interface ModelOption {
  value: string;
  label: string;
  description: string;
}

export const DEFAULT_STAGE_MODELS: StageModelConfig = {
  storyboard: 'gemini-2.5-flash',
  images:     'gemini-2.5-flash-image',
  videos:     'veo-3.1-fast-generate-preview',
  voiceover:  'gemini-2.5-flash-preview-tts',
  music:      'lyria-3-clip-preview',
};

export const STAGE_MODEL_OPTIONS: Record<keyof StageModelConfig, ModelOption[]> = {
  storyboard: [
    { value: 'gemini-2.5-flash-lite', label: 'Flash Lite', description: 'Fastest · cheapest' },
    { value: 'gemini-2.5-flash',      label: 'Flash',      description: 'Balanced · default' },
    { value: 'gemini-2.5-pro',        label: 'Pro',        description: 'Most thorough' },
  ],
  images: [
    { value: 'gemini-2.5-flash-image',      label: 'Flash Image',        description: 'Fast image gen · default' },
    { value: 'gemini-3.1-flash-image-preview', label: 'Flash 3.1 Image', description: 'Latest preview' },
  ],
  videos: [
    { value: 'veo-3.1-lite-generate-preview', label: 'Veo Lite', description: 'Fast generation' },
    { value: 'veo-3.1-fast-generate-preview', label: 'Veo Fast', description: 'Balanced · default' },
    { value: 'veo-3.1-generate-preview',      label: 'Veo Full', description: 'Highest quality' },
  ],
  voiceover: [
    { value: 'gemini-2.5-flash-preview-tts', label: 'Flash TTS', description: 'Fast · default' },
    { value: 'gemini-2.5-pro-preview-tts',   label: 'Pro TTS',   description: 'Higher fidelity' },
  ],
  music: [
    { value: 'lyria-3-clip-preview', label: 'Lyria Clip', description: 'Short clips · default' },
    { value: 'lyria-3-pro-preview',  label: 'Lyria Pro',  description: 'Full songs' },
  ],
};

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
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs: number;
  createdAt: Date;
}

// ─── Cost Breakdown ───────────────────────────────────────────────────────────

export interface StageCostEntry {
  stageKey: StageKey;
  costUSD: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  attempts: number;
}

export interface CostBreakdown {
  stages: Partial<Record<StageKey, StageCostEntry>>;
  totalCostUSD: number;
  totalTokens: number;
  estimatedCostUSD: number;
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
  /** images stage only — sceneId (as string key) → filename stored on disk */
  referenceImages?: Record<string, string>;
  /** sceneId (or "0" for single-file stages) → ordered array of versioned filenames */
  sceneVersions?: Record<string, string[]>;
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
  costBreakdown?: CostBreakdown;
  modelConfig?: StageModelConfig;
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
  costUSD?: number;
  totalCostUSD?: number;
  tokenCount?: number;
}

export interface CostUpdateEvent {
  projectId: string;
  totalCostUSD: number;
  breakdown: CostBreakdown;
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
