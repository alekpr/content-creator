import { Schema, model, Document } from 'mongoose';
import type {
  NicheInput,
  NicheResult,
  NicheCompetition,
  NicheGrowthTrend,
} from '@content-creator/shared';

const SUPPORTED_LANGUAGES = ['en', 'th', 'ja', 'zh', 'ko'] as const;

function hasUniqueStrings(values: string[]): boolean {
  return new Set(values.map(value => value.trim().toLocaleLowerCase())).size === values.length;
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const NicheInputSchema = new Schema<NicheInput>(
  {
    interests: { type: String, required: true },
    platforms: {
      type: [{ type: String, enum: ['youtube', 'tiktok', 'instagram', 'linkedin'] }],
      required: true,
      validate: {
        validator: (value: string[]) => Array.isArray(value) && value.length > 0,
        message: 'At least one platform is required',
      },
    },
    timePerWeek: { type: String, enum: ['low', 'mid', 'high'], required: true },
    goal: { type: String, enum: ['income', 'passive', 'affiliate', 'brand'], required: true },
    budgetTHB: { type: Number, required: true, min: 0 },
    language: { type: String, enum: SUPPORTED_LANGUAGES, required: true },
    market: { type: String, enum: ['thai', 'global', 'both'], required: true },
  },
  { _id: false }
);

const RpmRangeSchema = new Schema<{ min: number; max: number }>(
  {
    min: { type: Number, required: true, min: 0 },
    max: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

RpmRangeSchema.pre('validate', function (next) {
  if (this.max < this.min) {
    this.invalidate('max', 'rpmRangeTHB.max must be greater than or equal to min');
  }
  next();
});

const NicheResultSchema = new Schema<NicheResult>(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    rpmRangeTHB: { type: RpmRangeSchema, required: true },
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
    monetizationMethods: {
      type: [String],
      required: true,
      validate: {
        validator: (value: string[]) => Array.isArray(value) && value.length >= 1 && value.every(item => item.trim().length > 0) && hasUniqueStrings(value),
        message: 'monetizationMethods must contain at least one unique non-empty value',
      },
    },
    fitScore: { type: Number, required: true, min: 0, max: 100 },
    whyFit: { type: String, required: true },
    contentIdeas: {
      type: [String],
      required: true,
      validate: {
        validator: (value: string[]) => Array.isArray(value) && value.length >= 5 && value.every(item => item.trim().length > 0) && hasUniqueStrings(value),
        message: 'contentIdeas must contain at least 5 unique non-empty values',
      },
    },
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
    results: {
      type: [NicheResultSchema],
      required: true,
      validate: {
        validator: (value: NicheResult[]) => Array.isArray(value) && value.length === 3 && hasUniqueStrings(value.map(item => item.name)),
        message: 'results must contain exactly 3 uniquely named niches',
      },
    },
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

NicheAnalysisSchema.path('topPick').validate({
  validator: function (this: NicheAnalysisDocument, value: string) {
    return this.results.some(result => result.name.trim().toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  },
  message: 'topPick must match one of the generated niche names',
});

NicheAnalysisSchema.index({ createdAt: -1 });

export const NicheAnalysisModel = model<NicheAnalysisDocument>('NicheAnalysis', NicheAnalysisSchema);
