import { z } from 'zod';
import { ai } from './gemini.service.js';
import { NicheAnalysisModel, type NicheAnalysisDocument } from '../models/NicheAnalysis.model.js';
import type { NicheInput, NicheResult } from '@content-creator/shared';

// ─── Gemini Pricing (Flash) ───────────────────────────────────────────────────

const FLASH_INPUT_COST_PER_TOKEN  = 0.075 / 1_000_000;
const FLASH_OUTPUT_COST_PER_TOKEN = 0.30  / 1_000_000;
const NICHE_MODEL = 'gemini-2.5-flash';

// ─── Zod Validators ───────────────────────────────────────────────────────────

const NicheResultSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  rpmRangeTHB: z.object({ min: z.number(), max: z.number() }),
  competition: z.enum(['low', 'medium', 'high']),
  growthTrend: z.enum(['growing', 'stable', 'declining']),
  monetizationMethods: z.array(z.string()),
  fitScore: z.number().min(0).max(100),
  whyFit: z.string().min(1),
  contentIdeas: z.array(z.string()),
  suggestedTopic: z.string().min(1),
  suggestedStyle: z.enum(['cinematic', 'educational', 'promotional', 'documentary']),
});

const GeminiNicheResponseSchema = z.object({
  niches: z.array(NicheResultSchema).min(1).max(5),
  topPick: z.string().min(1),
  tip: z.string().default(''),
});

// ─── Prompt Builder ───────────────────────────────────────────────────────────

export function buildNichePrompt(input: NicheInput): string {
  const timeLabel = input.timePerWeek === 'low' ? '< 5h/week' : input.timePerWeek === 'mid' ? '5–15h/week' : '> 15h/week';
  const budgetLabel = input.budgetTHB === 0 ? 'no budget' : `${input.budgetTHB} THB/month`;

  return `
You are a Faceless Video content strategy expert specializing in YouTube, TikTok, Instagram, and LinkedIn.
Analyze the user profile below and return ONLY valid JSON — no markdown, no text outside JSON.

User profile:
- Interests/expertise: "${input.interests}"
- Target platforms: ${input.platforms.join(', ')}
- Available time: ${timeLabel}
- Primary goal: ${input.goal}
- Monthly budget: ${budgetLabel}
- Content language: ${input.language}
- Target market: ${input.market}

Return exactly this JSON structure:
{
  "niches": [
    {
      "name": "string — niche name in ${input.language === 'th' ? 'Thai' : 'English'}",
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
- rpmRangeTHB values must be realistic estimates in Thai Baht (1 USD ≈ 36 THB)
- fitScore must reflect how well the niche matches the user's time, budget, goal, and interests
- contentIdeas must be specific video titles, not generic topics
- suggestedTopic must be a specific, ready-to-use topic string for Stage 1 storyboard
- All text in ${input.language === 'th' ? 'Thai language' : 'English language'} unless it is a proper noun
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
    config: { responseMimeType: 'application/json' },
  });

  const rawText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!rawText) throw new Error('Empty response from Gemini');

  const cleaned = rawText.replace(/```json|```/g, '').trim();
  const parsed: unknown = JSON.parse(cleaned);
  return z.array(z.string().min(1)).min(1).max(10).parse(parsed);
}

// ─── Analyze ──────────────────────────────────────────────────────────────────

export async function analyzeNiche(input: NicheInput): Promise<NicheAnalysisDocument> {
  const startTime = Date.now();
  const prompt = buildNichePrompt(input);

  const response = await ai.models.generateContent({
    model: NICHE_MODEL,
    contents: [{ parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json' },
  });

  const inputTokens  = response.usageMetadata?.promptTokenCount    ?? 0;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
  const totalTokens  = response.usageMetadata?.totalTokenCount      ?? (inputTokens + outputTokens);

  const rawText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!rawText) throw new Error('Empty response from Gemini');

  const cleaned = rawText.replace(/```json|```/g, '').trim();
  const parsed: unknown = JSON.parse(cleaned);
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
