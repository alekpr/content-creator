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

export const DURATION_VALUES = ['32s', '64s', '160s'] as const;

export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'linkedin';
export type Duration = (typeof DURATION_VALUES)[number];
export type Style = 'cinematic' | 'educational' | 'promotional' | 'documentary';
export type Language = 'en' | 'th' | 'ja' | 'zh' | 'ko';

// ─── Stage Model Config ───────────────────────────────────────────────────────

export type StoryboardModel = 'gemini-2.5-flash-lite' | 'gemini-2.5-flash' | 'gemini-2.5-pro';
export type ImageModel     = 'gemini-2.5-flash-image' | 'gemini-3.1-flash-image-preview' | 'mock';
export type VideoModel     = 'veo-3.1-lite-generate-preview' | 'veo-3.1-fast-generate-preview' | 'veo-3.1-generate-preview' | 'mock';
export type VoiceoverModel = 'gemini-2.5-flash-preview-tts' | 'gemini-2.5-pro-preview-tts' | 'gemini-3.1-flash-tts-preview';
export type TtsVoice =
  | 'Zephyr' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Leda' | 'Orus' | 'Aoede'
  | 'Callirrhoe' | 'Autonoe' | 'Enceladus' | 'Iapetus' | 'Umbriel' | 'Algieba'
  | 'Despina' | 'Erinome' | 'Algenib' | 'Rasalgethi' | 'Laomedeia' | 'Achernar'
  | 'Alnilam' | 'Schedar' | 'Gacrux' | 'Pulcherrima' | 'Achird' | 'Zubenelgenubi'
  | 'Vindemiatrix' | 'Sadachbia' | 'Sadaltager' | 'Sulafat';
export type Voice = TtsVoice; // Supports all 30 voices
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
  voiceover:  'gemini-2.5-pro-preview-tts',
  music:      'lyria-3-clip-preview',
};

export const STAGE_MODEL_OPTIONS: Record<keyof StageModelConfig, ModelOption[]> = {
  storyboard: [
    { value: 'gemini-2.5-flash-lite', label: 'Flash Lite', description: 'Fastest · cheapest' },
    { value: 'gemini-2.5-flash',      label: 'Flash',      description: 'Balanced · default' },
    { value: 'gemini-2.5-pro',        label: 'Pro',        description: 'Most thorough' },
  ],
  images: [
    { value: 'gemini-2.5-flash-image',         label: 'Flash Image',        description: 'Fast image gen · default' },
    { value: 'gemini-3.1-flash-image-preview', label: 'Flash 3.1 Image',    description: 'Latest preview' },
    { value: 'mock',                           label: 'Mock (Test)',         description: 'Blank placeholder · free · no API call' },
  ],
  videos: [
    { value: 'veo-3.1-lite-generate-preview', label: 'Veo Lite', description: 'Fast generation' },
    { value: 'veo-3.1-fast-generate-preview', label: 'Veo Fast', description: 'Balanced · default' },
    { value: 'veo-3.1-generate-preview',      label: 'Veo Full', description: 'Highest quality' },
    { value: 'mock',                          label: 'Mock (Test)',         description: 'Blank placeholder · free · no API call' },
  ],
  voiceover: [
    { value: 'gemini-2.5-flash-preview-tts', label: 'Flash TTS',      description: 'Fast · default' },
    { value: 'gemini-2.5-pro-preview-tts',   label: 'Pro TTS',        description: 'Higher fidelity' },
    { value: 'gemini-3.1-flash-tts-preview', label: 'Flash 3.1 TTS',  description: 'Latest · audio tag support' },
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

export type StoryboardAct = 'hook' | 'context' | 'but' | 'reveal';

export interface StoryboardScene {
  id: number;
  act?: StoryboardAct;
  duration: 4 | 6 | 8;
  narration: string;
  /** Cinematic overview — maps to "Scene:" section of video prompt */
  visual_prompt: string;
  /** Main subject/object — maps to "Subject:" section */
  subject?: string;
  /** What physically happens in the clip — maps to "Action:" section */
  action?: string;
  /** Frame layout / depth / symmetry — maps to "Composition:" section */
  composition?: string;
  /** Ambiance and lighting description — maps to "Ambiance / Lighting:" section */
  lighting?: string;
  negative_prompt: string;
  camera_motion: string;
  mood: string;
  /** Focal point guidance for Stage 2 image generation — where viewer attention should concentrate */
  focal_point?: string;
}

export interface ImageStyleBrief {
  visualUniverse: string;
  palette: string;
  lightingStyle: string;
  compositionStyle: string;
  renderingStyle: string;
  characterConsistency: string;
  environmentConsistency: string;
  moodProgression: string;
  negativeGuardrails: string;
}

export interface SocialMeta {
  /** Platform-optimised video title (YouTube / TikTok / etc.) */
  videoTitle: string;
  /** Short description / caption suitable for the platform */
  description: string;
  /** Hashtags (each string starts with #) — AI-generated + default brand tags */
  hashtags: string[];
}

export interface Storyboard {
  title: string;
  hook: string;
  scenes: StoryboardScene[];
  total_scenes: number;
  estimated_duration_seconds: number;
  music_mood: string;
  /** Auto-generated by Stage 1 — reused by Stage 2 to keep image theme and mood consistent across scenes */
  imageStyleBrief?: ImageStyleBrief;
  /** Auto-generated by Stage 1 — used to pre-fill Stage 4 voiceover settings and Stage 5 music prompt */
  directorsBrief?: DirectorsBrief;
  /** Auto-generated by Stage 1 — title, description, and hashtags ready for YouTube / TikTok upload */
  socialMeta?: SocialMeta;
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

// ─── TTS Voice Options ──────────────────────────────────────────────────────

export interface VoiceMetadata {
  name: TtsVoice;
  description: string;
  gender: 'female' | 'male';
}

export const TTS_VOICES: TtsVoice[] = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];

export const TTS_VOICE_METADATA: VoiceMetadata[] = [
  { name: 'Zephyr', description: 'Bright', gender: 'female' },
  { name: 'Puck', description: 'Upbeat', gender: 'male' },
  { name: 'Charon', description: 'Informative', gender: 'male' },
  { name: 'Kore', description: 'Firm', gender: 'female' },
  { name: 'Fenrir', description: 'Excitable', gender: 'male' },
  { name: 'Leda', description: 'Youthful', gender: 'female' },
  { name: 'Orus', description: 'Firm', gender: 'male' },
  { name: 'Aoede', description: 'Breezy', gender: 'female' },
  { name: 'Callirrhoe', description: 'Easy-going', gender: 'female' },
  { name: 'Autonoe', description: 'Bright', gender: 'female' },
  { name: 'Enceladus', description: 'Breathy', gender: 'male' },
  { name: 'Iapetus', description: 'Clear', gender: 'male' },
  { name: 'Umbriel', description: 'Easy-going', gender: 'male' },
  { name: 'Algieba', description: 'Smooth', gender: 'female' },
  { name: 'Despina', description: 'Smooth', gender: 'female' },
  { name: 'Erinome', description: 'Clear', gender: 'female' },
  { name: 'Algenib', description: 'Gravelly', gender: 'male' },
  { name: 'Rasalgethi', description: 'Informative', gender: 'male' },
  { name: 'Laomedeia', description: 'Upbeat', gender: 'female' },
  { name: 'Achernar', description: 'Soft', gender: 'male' },
  { name: 'Alnilam', description: 'Firm', gender: 'male' },
  { name: 'Schedar', description: 'Even', gender: 'female' },
  { name: 'Gacrux', description: 'Mature', gender: 'male' },
  { name: 'Pulcherrima', description: 'Forward', gender: 'female' },
  { name: 'Achird', description: 'Friendly', gender: 'female' },
  { name: 'Zubenelgenubi', description: 'Casual', gender: 'male' },
  { name: 'Vindemiatrix', description: 'Gentle', gender: 'female' },
  { name: 'Sadachbia', description: 'Lively', gender: 'female' },
  { name: 'Sadaltager', description: 'Knowledgeable', gender: 'male' },
  { name: 'Sulafat', description: 'Warm', gender: 'female' },
];

// ─── Voiceover / Music ────────────────────────────────────────────────────────

export interface VoiceoverSceneConfig {
  sceneId: number;
  narration: string;
  targetDurationSeconds: number;
}

export interface VoiceoverDirectorNotes {
  style: string;
  pacing: string;
  accent: string;
}

// ─── Director's Brief (auto-generated by Stage 1, used in Stage 4 & 5) ────────

export interface DirectorsBriefVoiceover {
  /** Narrator persona — e.g. "warm, confident Thai storyteller" */
  narratorPersona: string;
  /** Emotional arc across the whole video — e.g. "start curious → build tension → satisfying reveal" */
  emotionalArc: string;
  /** Delivery style — e.g. "conversational, pause after twist moments" */
  deliveryStyle: string;
  /** Pacing guidance — e.g. "medium-fast, slow down during BUT act" */
  pacing: string;
  /** Accent / language notes — e.g. "neutral Thai, clear articulation" */
  accent: string;
  /** AI-recommended voice based on story characters and content — e.g. "Kore" (Female, Firm) */
  recommendedVoice?: string;
}

export interface DirectorsBriefMusic {
  /** Music genre — e.g. "cinematic electronic" */
  genre: string;
  /** Tempo — e.g. "medium 95 BPM" */
  tempo: string;
  /** Instruments — e.g. "piano, light strings, subtle percussion" */
  instruments: string;
  /** Mood arc following narrative structure — e.g. "mysterious → building tension → triumphant" */
  moodArc: string;
  /** Full text prompt ready to send to music model */
  promptText: string;
}

export interface DirectorsBrief {
  voiceover: DirectorsBriefVoiceover;
  music: DirectorsBriefMusic;
}

export interface VoiceoverStageConfig {
  voice?: string;
  directorNotes?: VoiceoverDirectorNotes;
  sceneNarrations?: Record<string, string>;
  tagMoodInstruction?: string;
}

export interface VoiceoverConfig {
  script: string;
  voice: Voice;
  speed: number;
  language: Language;
  scenes: VoiceoverSceneConfig[];
  directorNotes?: VoiceoverDirectorNotes;
}

export interface VoiceoverSceneTiming {
  sceneId: number;
  /** Actual audio duration after TTS — may exceed videoDuration */
  audioDuration: number;
  /** Original storyboard scene duration */
  videoDuration: number;
}

export interface VoiceoverSceneAudio {
  filename: string;
  previewUrl: string;
  durationSeconds: number;
  narrationUsed: string;
}

export interface VoiceoverResult {
  audioPath: string;
  filename: string;
  previewUrl: string;
  durationSeconds?: number;
  sceneTimings?: VoiceoverSceneTiming[];
  /** Per-scene fitted audio files, keyed by sceneId string */
  sceneAudio?: Record<string, VoiceoverSceneAudio>;
}

export interface MusicResult {
  musicPath: string;
  filename: string;
  previewUrl: string;
  durationSeconds?: number;
}

export interface MusicStageConfig {
  /** Custom music prompt — overrides directors_brief.music.promptText and storyboard.music_mood */
  customPrompt?: string;
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

/** Persisted user settings for the assembly stage (stored in stageConfig). */
/**
 * How to fit a video clip when its duration doesn't match the voiceover:
 *   'speed'  — slow down or speed up the clip (bounded by maxSpeedRatio)
 *   'freeze' — freeze the last frame when audio is longer; trim when audio is shorter
 */
export type VideoFitMode = 'speed' | 'freeze';

/**
 * How scenes are joined in Stage 6 assembly:
 *   'cut'   — hard cut (fast concat, no re-encoding)
 *   'xfade' — crossfade transition (slower, requires re-encoding)
 */
export type SceneTransitionMode = 'cut' | 'xfade';

export interface AssemblyStageConfig {
  voiceVolume?: number;       // 0.0 – 1.0
  musicVolume?: number;       // 0.0 – 1.0
  fadeInSeconds?: number;     // audio fade-in duration
  fadeOutSeconds?: number;    // audio fade-out duration
  outputQuality?: 'standard' | 'high';
  /** How to sync video clip length to voiceover. Default: 'freeze' */
  videoFitMode?: VideoFitMode;
  /** Max speed-up ratio allowed before falling back to trim (only used when videoFitMode='speed'). Default: 1.5 */
  maxSpeedRatio?: number;
  /** Whether background music should loop to fill the whole voiceover duration. Default: true */
  loopBackgroundMusic?: boolean;
  /** How scenes are joined together. Default: 'cut' */
  sceneTransitionMode?: SceneTransitionMode;
  /** Duration of crossfade transition between scenes (only used when sceneTransitionMode='xfade'). Default: 0.5 */
  transitionDurationSeconds?: number;
}

export interface AssemblyConfig {
  voiceVolume: number;
  musicVolume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  outputFormat: 'mp4';
  outputQuality: 'standard' | 'high';
  /** How to sync video clip length to voiceover. Default: 'freeze' */
  videoFitMode: VideoFitMode;
  /** Max speed ratio before fallback to trim/freeze (used when videoFitMode='speed'). Default: 1.5 */
  maxSpeedRatio: number;
  /** Whether background music should loop to fill the whole voiceover duration. Default: true */
  loopBackgroundMusic: boolean;
  /** How scenes are joined together. Default: 'cut' */
  sceneTransitionMode: SceneTransitionMode;
  /** Duration of crossfade transition between scenes (only used when sceneTransitionMode='xfade'). Default: 0.5 */
  transitionDurationSeconds: number;
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
  /** per-stage user configuration (voiceover: voice, directorNotes, sceneNarrations) */
  stageConfig?: Record<string, unknown>;
}

// ─── Project ──────────────────────────────────────────────────────────────────

export type ProjectStatus = 'in_progress' | 'completed' | 'archived';

export type PublishPlatform = 'youtube' | 'tiktok' | 'facebook';

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
  /** Array of platforms where this project has been published */
  publishedTo?: PublishPlatform[];
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

// ─── Niche Finder ─────────────────────────────────────────────────────────────

export type NicheTimePerWeek = 'low' | 'mid' | 'high';
export type NicheGoal = 'income' | 'passive' | 'affiliate' | 'brand';
export type NicheMarket = 'thai' | 'global' | 'both';
export type NicheCompetition = 'low' | 'medium' | 'high';
export type NicheGrowthTrend = 'growing' | 'stable' | 'declining';

export interface NicheInput {
  interests: string;
  platforms: Platform[];
  timePerWeek: NicheTimePerWeek;
  goal: NicheGoal;
  budgetTHB: number;
  language: Language;
  market: NicheMarket;
}

export interface NicheResult {
  name: string;
  description: string;
  rpmRangeTHB: { min: number; max: number };
  competition: NicheCompetition;
  growthTrend: NicheGrowthTrend;
  monetizationMethods: string[];
  fitScore: number;
  whyFit: string;
  contentIdeas: string[];
  suggestedTopic: string;
  suggestedStyle: Style;
}

export interface NicheAnalysisResponse {
  id: string;
  topPick: string;
  tip: string;
  results: NicheResult[];
  costUSD: number;
  durationMs: number;
  createdAt: string;
}
