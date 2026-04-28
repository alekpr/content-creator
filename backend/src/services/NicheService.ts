import { z } from 'zod';
import { Type, type Schema } from '@google/genai';
import { ai } from './gemini.service.js';
import { NicheAnalysisModel, type NicheAnalysisDocument } from '../models/NicheAnalysis.model.js';
import type { NicheInput, NicheResult } from '@content-creator/shared';

// ─── Gemini Pricing (Flash) ───────────────────────────────────────────────────

const FLASH_INPUT_COST_PER_TOKEN  = 0.075 / 1_000_000;
const FLASH_OUTPUT_COST_PER_TOKEN = 0.30  / 1_000_000;
const NICHE_MODEL = 'gemini-2.5-flash';

const LANGUAGE_LABELS: Record<NicheInput['language'], string> = {
  th: 'Thai',
  en: 'English',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
};

const MARKET_LABELS: Record<NicheInput['market'], string> = {
  thai: 'Thai market',
  global: 'Global market',
  both: 'Thai and global markets',
};

const ZString = z.string().trim().min(1);

const GeminiNicheResponseJsonSchema: Schema = {
  type: Type.OBJECT,
  required: ['niches', 'topPick', 'tip'],
  propertyOrdering: ['niches', 'topPick', 'tip'],
  properties: {
    niches: {
      type: Type.ARRAY,
      minItems: '3',
      maxItems: '3',
      items: {
        type: Type.OBJECT,
        required: [
          'name',
          'description',
          'rpmRangeTHB',
          'competition',
          'growthTrend',
          'monetizationMethods',
          'fitScore',
          'whyFit',
          'contentIdeas',
          'suggestedTopic',
          'suggestedStyle',
        ],
        properties: {
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          rpmRangeTHB: {
            type: Type.OBJECT,
            required: ['min', 'max'],
            properties: {
              min: { type: Type.NUMBER },
              max: { type: Type.NUMBER },
            },
          },
          competition: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
          growthTrend: { type: Type.STRING, enum: ['growing', 'stable', 'declining'] },
          monetizationMethods: {
            type: Type.ARRAY,
            minItems: '1',
            items: { type: Type.STRING },
          },
          fitScore: { type: Type.NUMBER, minimum: 0, maximum: 100 },
          whyFit: { type: Type.STRING },
          contentIdeas: {
            type: Type.ARRAY,
            minItems: '5',
            maxItems: '5',
            items: { type: Type.STRING },
          },
          suggestedTopic: { type: Type.STRING },
          suggestedStyle: { type: Type.STRING, enum: ['cinematic', 'educational', 'promotional', 'documentary'] },
        },
      },
    },
    topPick: { type: Type.STRING },
    tip: { type: Type.STRING },
  },
};

const GeminiIdeasResponseJsonSchema: Schema = {
  type: Type.ARRAY,
  minItems: '5',
  maxItems: '5',
  items: { type: Type.STRING },
};

// ─── Zod Validators ───────────────────────────────────────────────────────────

const NicheResultSchema = z.object({
  name: ZString,
  description: ZString,
  rpmRangeTHB: z.object({ min: z.number().min(0), max: z.number().min(0) }).superRefine((value, ctx) => {
    if (value.max < value.min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rpmRangeTHB.max must be greater than or equal to min',
        path: ['max'],
      });
    }
  }),
  competition: z.enum(['low', 'medium', 'high']),
  growthTrend: z.enum(['growing', 'stable', 'declining']),
  monetizationMethods: z.array(ZString).min(1),
  fitScore: z.number().min(0).max(100),
  whyFit: ZString,
  contentIdeas: z.array(ZString).length(5),
  suggestedTopic: ZString,
  suggestedStyle: z.enum(['cinematic', 'educational', 'promotional', 'documentary']),
}).superRefine((value, ctx) => {
  const uniqueIdeas = new Set(value.contentIdeas.map(idea => idea.toLocaleLowerCase()));
  if (uniqueIdeas.size !== value.contentIdeas.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'contentIdeas must contain 5 unique entries',
      path: ['contentIdeas'],
    });
  }

  const uniqueMethods = new Set(value.monetizationMethods.map(method => method.toLocaleLowerCase()));
  if (uniqueMethods.size !== value.monetizationMethods.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'monetizationMethods must not contain duplicates',
      path: ['monetizationMethods'],
    });
  }

  if (value.suggestedTopic.toLocaleLowerCase() === value.name.toLocaleLowerCase()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'suggestedTopic must be more specific than the niche name',
      path: ['suggestedTopic'],
    });
  }
});

const GeminiNicheResponseSchema = z.object({
  niches: z.array(NicheResultSchema).length(3),
  topPick: ZString,
  tip: z.string().trim().default(''),
}).superRefine((value, ctx) => {
  const nicheNames = value.niches.map(niche => niche.name);
  const uniqueNames = new Set(nicheNames.map(name => name.toLocaleLowerCase()));

  if (uniqueNames.size !== nicheNames.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'niches must contain unique names',
      path: ['niches'],
    });
  }

  if (!nicheNames.some(name => name.toLocaleLowerCase() === value.topPick.toLocaleLowerCase())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'topPick must match one of the niche names',
      path: ['topPick'],
    });
  }
});

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeUniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const cleaned = normalizeText(value);
    const key = cleaned.toLocaleLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    normalized.push(cleaned);
  }

  return normalized;
}

function normalizeGeneratedNicheResponse(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object') return parsed;

  const response = parsed as {
    niches?: Array<Record<string, unknown>>;
    topPick?: unknown;
    tip?: unknown;
  };

  return {
    ...response,
    topPick: typeof response.topPick === 'string' ? normalizeText(response.topPick) : response.topPick,
    tip: typeof response.tip === 'string' ? normalizeText(response.tip) : response.tip,
    niches: Array.isArray(response.niches)
      ? response.niches.map(niche => ({
          ...niche,
          name: typeof niche.name === 'string' ? normalizeText(niche.name) : niche.name,
          description: typeof niche.description === 'string' ? normalizeText(niche.description) : niche.description,
          whyFit: typeof niche.whyFit === 'string' ? normalizeText(niche.whyFit) : niche.whyFit,
          suggestedTopic: typeof niche.suggestedTopic === 'string' ? normalizeText(niche.suggestedTopic) : niche.suggestedTopic,
          monetizationMethods: Array.isArray(niche.monetizationMethods)
            ? normalizeUniqueStrings(niche.monetizationMethods.filter((item): item is string => typeof item === 'string'))
            : niche.monetizationMethods,
          contentIdeas: Array.isArray(niche.contentIdeas)
            ? normalizeUniqueStrings(niche.contentIdeas.filter((item): item is string => typeof item === 'string'))
            : niche.contentIdeas,
        }))
      : response.niches,
  };
}

function normalizeIdeasResponse(parsed: unknown): unknown {
  return Array.isArray(parsed)
    ? normalizeUniqueStrings(parsed.filter((item): item is string => typeof item === 'string'))
    : parsed;
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

export function buildNichePrompt(input: NicheInput): string {
  const timeLabel = input.timePerWeek === 'low' ? '< 5h/week' : input.timePerWeek === 'mid' ? '5–15h/week' : '> 15h/week';
  const budgetLabel = input.budgetTHB === 0 ? 'no budget' : `${input.budgetTHB} THB/month`;
  const languageLabel = LANGUAGE_LABELS[input.language] ?? 'English';
  const marketLabel = MARKET_LABELS[input.market];

  return `
You are a faceless video content strategist specializing in YouTube, TikTok, Instagram, and LinkedIn.
Your job is to recommend 3 distinct, realistic niches that this creator can execute well.
Return ONLY valid JSON with no markdown, no comments, and no text outside JSON.

User profile:
- Interests/expertise: "${input.interests}"
- Target platforms: ${input.platforms.join(', ')}
- Available time: ${timeLabel}
- Primary goal: ${input.goal}
- Monthly budget: ${budgetLabel}
- Content language: ${languageLabel}
- Target market: ${marketLabel}

Evaluation priorities:
- Optimize for a faceless workflow and repeatable production cadence.
- The 3 niches must be meaningfully different in audience, content angle, and monetization strategy.
- Prefer niches that realistically fit the user's available time, budget, goal, and interests.
- Consider platform-market fit explicitly. Recommendations for TikTok/Instagram should skew toward short-form repeatability; YouTube may support higher RPM educational/documentary angles; LinkedIn should favor professional and authority-driven topics.
- Use conservative RPM estimates adjusted for the selected market and likely monetization model.
- Use this scoring rubric for fitScore: interests/expertise 35%, monetization potential 25%, time feasibility 20%, budget fit 10%, platform-market fit 10%.
- Unless the goal strongly suggests otherwise, avoid niches that require the creator to appear on camera or rely heavily on personal branding.

Return exactly this JSON structure:
{
  "niches": [
    {
      "name": "string — niche name in ${languageLabel}",
      "description": "1–2 sentence description",
      "rpmRangeTHB": { "min": number, "max": number },
      "competition": "low" | "medium" | "high",
      "growthTrend": "growing" | "stable" | "declining",
      "monetizationMethods": ["method1", "method2", ...],
      "fitScore": number between 0–100 based on user profile fit,
      "whyFit": "1 sentence explaining why this fits the profile",
      "contentIdeas": ["idea1", "idea2", "idea3", "idea4", "idea5"],
      "suggestedTopic": "specific video topic for POST /api/projects",
      "suggestedStyle": "cinematic" | "educational" | "promotional" | "documentary"
    }
  ],
  "topPick": "name of the best niche from the list",
  "tip": "one actionable tip for this user profile"
}

Rules:
- Return exactly 3 niche objects in the array
- Each niche must be clearly different from the others, not a reworded variation
- rpmRangeTHB values must be realistic estimates in Thai Baht (1 USD ≈ 36 THB)
- fitScore must reflect how well the niche matches the user's time, budget, goal, and interests
- Give each niche at least 1 monetization method and make the methods practical for that niche
- contentIdeas must be specific video titles, not generic topics
- Return exactly 5 contentIdeas per niche, and every idea must be unique within that niche
- suggestedTopic must be a specific, ready-to-use topic string for Stage 1 storyboard
- suggestedTopic must be narrower and more specific than the niche name
- All user-facing text must be in ${languageLabel} unless it is a proper noun or platform name
`.trim();
}

// ─── Service ──────────────────────────────────────────────────────────────────

// ─── Generate More Ideas ──────────────────────────────────────────────────────

export async function generateMoreIdeas(
  nicheName: string,
  nicheDescription: string,
  existingIdeas: string[],
  language: string,
): Promise<string[]> {
  const langLabel = language === 'th' ? 'Thai language' : 'English language';
  const existingBlock = existingIdeas.map((idea, i) => `${i + 1}. ${idea}`).join('\n');

  const prompt = `
You are a Faceless Video content strategy expert.
Generate 5 NEW and UNIQUE video content ideas for the niche below.
Do NOT repeat or paraphrase any idea in the "Already used" list.
Each idea must be a specific, ready-to-use video title/topic (not a generic category).
Return ONLY a JSON array of 5 strings — no markdown, no text outside JSON.

Niche: "${nicheName}"
Description: "${nicheDescription}"
Language: ${langLabel}

Already used (DO NOT repeat these):
${existingBlock}

Return format:
["idea 1", "idea 2", "idea 3", "idea 4", "idea 5"]
`.trim();

  const response = await ai.models.generateContent({
    model: NICHE_MODEL,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: GeminiIdeasResponseJsonSchema,
    },
  });

  const rawText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!rawText) throw new Error('Empty response from Gemini');

  const cleaned = rawText.replace(/```json|```/g, '').trim();
  const parsed = normalizeIdeasResponse(JSON.parse(cleaned));
  return z.array(z.string().min(1)).min(1).max(10).parse(parsed);
}

// ─── Analyze ──────────────────────────────────────────────────────────────────

export async function analyzeNiche(input: NicheInput): Promise<NicheAnalysisDocument> {
  const startTime = Date.now();
  const prompt = buildNichePrompt(input);

  const response = await ai.models.generateContent({
    model: NICHE_MODEL,
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: GeminiNicheResponseJsonSchema,
    },
  });

  const inputTokens  = response.usageMetadata?.promptTokenCount    ?? 0;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
  const totalTokens  = response.usageMetadata?.totalTokenCount      ?? (inputTokens + outputTokens);

  const rawText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!rawText) throw new Error('Empty response from Gemini');

  const cleaned = rawText.replace(/```json|```/g, '').trim();
  const parsed = normalizeGeneratedNicheResponse(JSON.parse(cleaned));
  const validated = GeminiNicheResponseSchema.parse(parsed);

  const costUSD =
    inputTokens  * FLASH_INPUT_COST_PER_TOKEN +
    outputTokens * FLASH_OUTPUT_COST_PER_TOKEN;

  const durationMs = Date.now() - startTime;

  const doc = await NicheAnalysisModel.create({
    input,
    results: validated.niches as NicheResult[],
    topPick: validated.topPick,
    tip: validated.tip,
    modelUsed: NICHE_MODEL,
    costUSD,
    inputTokens,
    outputTokens,
    totalTokens,
    durationMs,
  });

  return doc;
}
