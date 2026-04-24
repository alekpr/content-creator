import { Schema, model, Document } from 'mongoose';
import type {
  ProjectInput,
  StageDoc,
  ProjectStatus,
  ProjectOutput,
  GenerationAttempt,
  CostBreakdown,
  StageModelConfig,
} from '@content-creator/shared';
import { DURATION_VALUES } from '@content-creator/shared';

const LEGACY_DURATION_MAP: Record<string, (typeof DURATION_VALUES)[number]> = {
  '30s': '32s',
  '60s': '64s',
  '3min': '160s',
};

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const GenerationAttemptSchema = new Schema<GenerationAttempt>(
  {
    attemptNumber: { type: Number, required: true },
    promptUsed: { type: Schema.Types.Mixed, required: true },
    outputPaths: [{ type: String }],
    costUSD: { type: Number, required: true, default: 0 },
    inputTokens: { type: Number },
    outputTokens: { type: Number },
    totalTokens: { type: Number },
    durationMs: { type: Number, required: true },
    createdAt: { type: Date, required: true },
  },
  { _id: false }
);

const StageDockSchema = new Schema<StageDoc>(
  {
    status: {
      type: String,
      enum: ['pending', 'prompt_ready', 'generating', 'review', 'approved', 'failed', 'skipped'],
      required: true,
      default: 'pending',
    },
    prompt: { type: Schema.Types.Mixed, default: '' },
    result: { type: Schema.Types.Mixed },
    reviewData: {
      previewUrl: String,
      previewUrls: [String],
      metadata: Schema.Types.Mixed,
    },
    attempts: { type: [GenerationAttemptSchema], default: [] },
    error: String,
    startedAt: Date,
    completedAt: Date,
    referenceImages: { type: Schema.Types.Mixed, default: {} },
    sceneVersions:   { type: Schema.Types.Mixed, default: {} },
    stageConfig:     { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

// ─── Main Project Schema ──────────────────────────────────────────────────────

export interface ProjectDocument extends Document {
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
  costBreakdown?: CostBreakdown;
  modelConfig?: StageModelConfig;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

const ProjectSchema = new Schema<ProjectDocument>(
  {
    title: { type: String, required: true },
    status: {
      type: String,
      enum: ['in_progress', 'completed', 'archived'],
      default: 'in_progress',
    },
    input: {
      topic: { type: String, required: true },
      platform: { type: String, enum: ['youtube', 'tiktok', 'instagram', 'linkedin'], required: true },
      duration: { type: String, enum: [...DURATION_VALUES], required: true },
      style: { type: String, enum: ['cinematic', 'educational', 'promotional', 'documentary'], required: true },
      language: { type: String, enum: ['en', 'th', 'ja', 'zh', 'ko'], required: true },
      voice: { type: String, required: true },
      includeMusic: { type: Boolean, required: true },
    },
    stages: {
      storyboard: { type: StageDockSchema, default: () => ({ status: 'pending', prompt: '', attempts: [] }) },
      images:     { type: StageDockSchema, default: () => ({ status: 'pending', prompt: '', attempts: [] }) },
      videos:     { type: StageDockSchema, default: () => ({ status: 'pending', prompt: '', attempts: [] }) },
      voiceover:  { type: StageDockSchema, default: () => ({ status: 'pending', prompt: '', attempts: [] }) },
      music:      { type: StageDockSchema, default: () => ({ status: 'pending', prompt: '', attempts: [] }) },
      assembly:   { type: StageDockSchema, default: () => ({ status: 'pending', prompt: '', attempts: [] }) },
    },
    output: {
      filePath: String,
      fileUrl: String,
      durationSeconds: Number,
      fileSizeBytes: Number,
    },
    costUSD: { type: Number, default: 0 },
    estimatedCostUSD: { type: Number, default: 0 },
    costBreakdown: { type: Schema.Types.Mixed },
    modelConfig: {
      storyboard: { type: String, default: 'gemini-2.5-flash' },
      images:     { type: String, default: 'gemini-2.5-flash' },
      videos:     { type: String, default: 'veo-3.1-fast-generate-preview' },
      voiceover:  { type: String, default: 'gemini-2.5-flash-preview-tts' },
      music:      { type: String, default: 'lyria-3-clip-preview' },
    },
    completedAt: Date,
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

ProjectSchema.index({ status: 1 });
ProjectSchema.index({ createdAt: -1 });

// Allow old projects to remain editable after duration enum migration.
ProjectSchema.pre('validate', function normalizeLegacyDuration(next) {
  const current = this.get('input.duration') as string | undefined;
  if (current && LEGACY_DURATION_MAP[current]) {
    this.set('input.duration', LEGACY_DURATION_MAP[current]);
  }
  next();
});

// ─── Model ────────────────────────────────────────────────────────────────────

export const ProjectModel = model<ProjectDocument>('Project', ProjectSchema);
