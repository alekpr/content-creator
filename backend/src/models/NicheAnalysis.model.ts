import { Schema, model, Document } from 'mongoose';
import type {
  NicheInput,
  NicheResult,
  NicheCompetition,
  NicheGrowthTrend,
} from '@content-creator/shared';

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const NicheInputSchema = new Schema<NicheInput>(
  {
    interests: { type: String, required: true },
    platforms: [{ type: String }],
    timePerWeek: { type: String, enum: ['low', 'mid', 'high'], required: true },
    goal: { type: String, enum: ['income', 'passive', 'affiliate', 'brand'], required: true },
    budgetTHB: { type: Number, required: true },
    language: { type: String, required: true },
    market: { type: String, enum: ['thai', 'global', 'both'], required: true },
  },
  { _id: false }
);

const NicheResultSchema = new Schema<NicheResult>(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    rpmRangeTHB: {
      min: { type: Number, required: true },
      max: { type: Number, required: true },
    },
    competition: {
      type: String,
      enum: ['low', 'medium', 'high'] satisfies NicheCompetition[],
      required: true,
    },
    growthTrend: {
      type: String,
      enum: ['growing', 'stable', 'declining'] satisfies NicheGrowthTrend[],
      required: true,
    },
    monetizationMethods: [{ type: String }],
    fitScore: { type: Number, required: true, min: 0, max: 100 },
    whyFit: { type: String, required: true },
    contentIdeas: [{ type: String }],
    suggestedTopic: { type: String, required: true },
    suggestedStyle: {
      type: String,
      enum: ['cinematic', 'educational', 'promotional', 'documentary'],
      required: true,
    },
  },
  { _id: false }
);

// ─── Main Document ────────────────────────────────────────────────────────────

export interface NicheAnalysisDocument extends Document {
  input: NicheInput;
  results: NicheResult[];
  topPick: string;
  tip: string;
  modelUsed: string;
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  createdAt: Date;
  updatedAt: Date;
}

const NicheAnalysisSchema = new Schema<NicheAnalysisDocument>(
  {
    input: { type: NicheInputSchema, required: true },
    results: { type: [NicheResultSchema], required: true },
    topPick: { type: String, required: true },
    tip: { type: String, required: true, default: '' },
    modelUsed: { type: String, required: true },
    costUSD: { type: Number, required: true, default: 0 },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

NicheAnalysisSchema.index({ createdAt: -1 });

export const NicheAnalysisModel = model<NicheAnalysisDocument>('NicheAnalysis', NicheAnalysisSchema);
