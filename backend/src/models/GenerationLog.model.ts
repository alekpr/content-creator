import { Schema, model, Document, Types } from 'mongoose';
import type { StageKey } from '@content-creator/shared';

export interface GenerationLogDocument extends Document {
  projectId: Types.ObjectId;
  stageKey: StageKey;
  attemptNumber: number;
  promptUsed: unknown;
  modelUsed: string;
  configUsed?: Record<string, unknown>;
  status: 'success' | 'failed';
  outputPaths: string[];
  error?: string;
  durationMs: number;
  costUSD: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  createdAt: Date;
}

const GenerationLogSchema = new Schema<GenerationLogDocument>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    stageKey: {
      type: String,
      enum: ['storyboard', 'images', 'videos', 'voiceover', 'music', 'assembly'],
      required: true,
    },
    attemptNumber: { type: Number, required: true },
    promptUsed: { type: Schema.Types.Mixed, required: true },
    modelUsed: { type: String, required: true },
    configUsed: { type: Schema.Types.Mixed },
    status: { type: String, enum: ['success', 'failed'], required: true },
    outputPaths: [{ type: String }],
    error: String,
    durationMs: { type: Number, required: true },
    costUSD: { type: Number, required: true, default: 0 },
    inputTokens: { type: Number },
    outputTokens: { type: Number },
    totalTokens: { type: Number },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────

GenerationLogSchema.index({ projectId: 1, stageKey: 1 });
GenerationLogSchema.index({ createdAt: -1 });

// ─── Model ────────────────────────────────────────────────────────────────────

export const GenerationLogModel = model<GenerationLogDocument>('GenerationLog', GenerationLogSchema);
