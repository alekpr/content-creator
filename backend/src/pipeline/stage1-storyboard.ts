import { z } from 'zod';
import { ai } from '../services/gemini.service.js';
import { ProjectModel } from '../models/Project.model.js';
import { GenerationLogModel } from '../models/GenerationLog.model.js';
import { durationToSceneCount } from '../utils/cost.calculator.js';
import type { ImageStyleBrief, ProjectInput, Storyboard } from '@content-creator/shared';

// ─── Zod Validators ───────────────────────────────────────────────────────────

const StoryboardSceneSchema = z.object({
  id: z.number(),
  act: z.enum(['hook', 'context', 'but', 'reveal']).optional(),
  duration: z.literal(8),
  narration: z.string().min(1),
  visual_prompt: z.string().min(1),
  subject: z.string().default(''),
  action: z.string().default(''),
  composition: z.string().default(''),
  lighting: z.string().default(''),
  negative_prompt: z.string().default(''),
  camera_motion: z.string().default('static'),
  mood: z.string().default('neutral'),
  focal_point: z.string().default(''),
});

const DirectorsBriefSchema = z.object({
  voiceover: z.object({
    narratorPersona: z.string().default(''),
    emotionalArc:    z.string().default(''),
    deliveryStyle:   z.string().default(''),
    pacing:          z.string().default(''),
    accent:          z.string().default(''),
    recommendedVoice: z.string().optional(),
  }),
  music: z.object({
    genre:       z.string().default(''),
    tempo:       z.string().default(''),
    instruments: z.string().default(''),
    moodArc:     z.string().default(''),
    promptText:  z.string().default(''),
  }),
});

const ImageStyleBriefSchema = z.object({
  visual_universe: z.string().default(''),
  palette: z.string().default(''),
  lighting_style: z.string().default(''),
  composition_style: z.string().default(''),
  rendering_style: z.string().default(''),
  character_consistency: z.string().default(''),
  environment_consistency: z.string().default(''),
  mood_progression: z.string().default(''),
  negative_guardrails: z.string().default(''),
});

const SocialMetaSchema = z.object({
  video_title: z.string().default(''),
  description: z.string().default(''),
  hashtags: z.array(z.string()).default([]),
});

const StoryboardSchema = z.object({
  title: z.string().min(1),
  hook: z.string().default(''),
  scenes: z.array(StoryboardSceneSchema).min(1),
  total_scenes: z.number(),
  estimated_duration_seconds: z.number(),
  music_mood: z.string().default('upbeat'),
  image_style_brief: ImageStyleBriefSchema.optional(),
  directors_brief: DirectorsBriefSchema.optional(),
  social_meta: SocialMetaSchema.optional(),
});

// Default hashtags always appended to AI-generated ones
export const DEFAULT_HASHTAGS = [
  '#TechBit', '#TechShorts', '#เล่าเรื่องเทค', '#ไอทีน่ารู้',
  '#สรุปเทค', '#เทคโนโลยี', '#Shorts',
];

function mapImageStyleBrief(brief: z.infer<typeof ImageStyleBriefSchema>): ImageStyleBrief {
  return {
    visualUniverse: brief.visual_universe,
    palette: brief.palette,
    lightingStyle: brief.lighting_style,
    compositionStyle: brief.composition_style,
    renderingStyle: brief.rendering_style,
    characterConsistency: brief.character_consistency,
    environmentConsistency: brief.environment_consistency,
    moodProgression: brief.mood_progression,
    negativeGuardrails: brief.negative_guardrails,
  };
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

export function buildStoryboardPrompt(input: ProjectInput): string {
  const sceneCount = durationToSceneCount(input.duration);

  // Words-per-second estimate by language (matches frontend badge logic)
  // Thai uses morpheme-based segmentation: ~2.2 spoken words/sec
  // Other languages (space-delimited): ~2.5 words/sec
  const wps = input.language === 'th' ? 2.2 : 2.5;
  const targetWords = Math.round(8 * wps);

  // Narrative arc allocation per total scene count
  // Structure: Hook → Context → But → Reveal
  const arcGuide = sceneCount === 4
    ? `Scene 1: Hook | Scene 2: Context | Scene 3: But | Scene 4: Reveal`
    : sceneCount === 8
    ? `Scene 1: Hook | Scenes 2–3: Context | Scenes 4–6: But | Scenes 7–8: Reveal`
    : /* 20 */ `Scenes 1–2: Hook | Scenes 3–7: Context | Scenes 8–15: But | Scenes 16–20: Reveal`;

  return `
คุณเป็น storytelling video director และ scriptwriter มืออาชีพ
สร้าง video storyboard แบบ JSON เท่านั้น ห้าม markdown หรือ text นอก JSON

Platform: ${input.platform} (${input.platform === 'tiktok' ? 'hook ใน 3 วินาทีแรก, กระชับ' : 'hook ใน 15 วินาที, อธิบายละเอียดได้'})
Language: ${input.language}
Style: ${input.style}
Total scenes: ${sceneCount} | Duration per scene: EXACTLY 8 วินาที (ทุก scene)
Total video duration: ${sceneCount * 8} วินาที

════════════════════════════════════════
STORYTELLING FRAMEWORK
════════════════════════════════════════
Content ต้องเล่าเป็นเรื่องราวต่อเนื่อง ไม่ใช่ list ของข้อมูล:

1. SHOW, DON'T TELL — อธิบายผ่านภาพและเหตุการณ์ ไม่ใช่แค่บอกข้อเท็จจริง
   ❌ "การนอนน้อยทำให้สมองทำงานแย่ลง"
   ✅ "วันที่สามที่ไม่ได้นอน — ฉันวางกุญแจไว้ในตู้เย็น"

2. NARRATOR VOICE — เลือก POV ที่ชัดเจนและคงไว้ตลอดทั้ง script:
   • First person ("ฉัน/ผม") — สร้าง intimacy, เหมาะกับ personal story
   • Second person ("คุณ") — ดึงผู้ชมเข้าสู่เรื่อง, เหมาะกับ educational
   • Third person (ตัวละคร) — เล่าผ่านตัวละคร, เหมาะกับ case study

3. EMOTIONAL BEATS — แต่ละ scene ต้องมี emotional shift เล็กๆ ที่นำไปสู่ climax ใน BUT
   Curiosity → Understanding → Tension → Resolution

4. SENSORY DETAILS — ใช้ detail ที่จำเพาะ ไม่ใช่ generic
   ❌ "เช้าวันหนึ่ง" ✅ "ตี 4 ครึ่ง ไฟยังติดอยู่ทั้งห้อง"

5. SCENE CONNECTOR — narration ต้องมี transition word/phrase ที่เชื่อม scene ก่อนหน้า
   เช่น "และนั่นคือจุดที่...", "แต่สิ่งที่ไม่มีใครรู้คือ...", "จนกระทั่งวันหนึ่ง..."

════════════════════════════════════════
NARRATIVE ARC — 4-act structure
════════════════════════════════════════
${arcGuide}

Act definitions:
• Hook    — เปิดด้วย scene ที่ทำให้ผู้ชม stop scrolling: คำถาม, ภาพที่ผิดปกติ, หรือ statement กระตุ้นความอยากรู้
• Context — สร้าง world และ character ที่ผู้ชมจะ care about; ให้ข้อมูลที่จำเป็นผ่านเรื่องราว ไม่ใช่ lecture
• But     — introduce ความขัดแย้ง, จุดเปลี่ยน หรือ twist; นี่คือ emotional peak ของเรื่อง
• Reveal  — resolve tension, ให้ insight หรือ lesson ที่ผู้ชมนำไปใช้ได้ทันที; จบด้วย call-to-action หรือ lasting image

Continuity rules:
- ตัวละคร, visual style, color palette ต้องสอดคล้องตลอด — นี่คือหนังเรื่องเดียว ไม่ใช่ ad แยกๆ
- Narration ต้องฟังดูเหมือน monologue หรือ voiceover ชิ้นเดียว เชื่อมต่อทุก scene
- Mood และ pacing เปลี่ยนค่อยเป็นค่อยไปตาม arc — ห้าม tone กระโดด
- Visual_prompt ของแต่ละ scene ต้องอยู่ใน visual universe เดียวกัน (ฉาก, lighting style, character design)
- CHARACTER VISUAL RULE (CRITICAL): Image generator ไม่รู้จักชื่อตัวละครใดๆ (อนิเมะ, หนัง, เกม, ฯลฯ)
  ❌ "Naruto runs through the forest" — model ไม่รู้ว่า Naruto หน้าตาอย่างไร
  ✅ "A young boy with spiky blonde hair, blue eyes, orange-and-black ninja jumpsuit with whisker marks on his cheeks, runs through a dense forest"
  → subject และ visual_prompt ต้องระบุ appearance จริง: สีผม, สีตา, ชุด, feature เด่น, build ทุกครั้งที่มีตัวละคร named
  → ถ้าตัวละครปรากฏทุก scene: ใช้ appearance เดิมให้สอดคล้องกันตลอด (visual consistency)
- Action คือ "กระดูกสันหลัง" ของ video prompt — ทุก scene MUST มี action ที่ชัดเจน, measurable, และ cinematic
  Rules for action:
  • ขึ้นต้นด้วย VERB เสมอ (walks, slides, shatters, transforms, reaches, reveals…)
  • ระบุ start state → movement → end state ให้ครบ
  • ต้องสามารถถ่ายทำได้จริงใน 8 วินาที — ไม่ abstract ไม่ metaphorical
  • ถ้า scene เป็น establishing shot: describe camera movement + subject reaction (e.g. 'Camera slowly pushes in on an empty chair at a dinner table; a single candle flickers out')
  • ทุก action ต้องสัมพันธ์กับ narration ของ scene นั้นๆ

- Focal Point (สำคัญสำหรับวิดีโอ): สำหรับวิดีโอคลิป ต้องมี focal point ที่ชัดเจนเพื่อให้ความสนใจรวมศูนย์ ไม่ให้กระจาย
  Guidelines:
  • ระบุ WHERE ในเฟรม (quadrant, position, distance) เช่น 'center-frame', 'upper-right per golden ratio', 'foreground with depth blur'
  • ระบุ WHAT (subject's face, action moment, key object, emotion) ที่ควรให้ดึงดูดสายตา
  • ระบุ HOW (composition technique) เช่น 'leading lines converging on subject', 'warm color contrast against cool background', 'size/scale dominance'
  • เหนือสิ่งอื่น ห้ามให้ background ดึงดูดสายตาเท่ากับ focal point — รสละคร focal point ต้องชนะ
  ✅ Good: "Subject's expression of realization in center frame, lit by warm window light, blurred bokeh background emphasizes subject"
  ❌ Bad: "A busy market scene with many people and colorful stalls"

Before writing the scenes, define ONE shared image style brief for the whole project.
This brief must be stable across every scene and should act as the master art direction for Stage 2 image generation.
It must lock these continuity anchors:
- visual universe / world identity
- color palette family
- lighting family
- composition language
- rendering / texture style
- recurring character appearance rules
- recurring environment rules
- mood progression across acts
- explicit things that must never drift

════════════════════════════════════════
NARRATION WORD COUNT (STRICT)
════════════════════════════════════════
ทุก scene มี duration = 8 วินาที
Word target: ~${targetWords} words ต่อ scene (${input.language}, spoken at natural pace)
Do NOT exceed ${targetWords + 3} words — audio will overflow the clip.

Topic: "${input.topic}"

JSON format (return this structure ONLY):
{
  "title": "string",
  "hook": "string (1 sentence — the narrative question this story answers)",
  "image_style_brief": {
    "visual_universe": "string — one concise sentence describing the shared world and aesthetic identity of the whole film",
    "palette": "string — recurring palette, key accent colors, saturation level, contrast feeling",
    "lighting_style": "string — stable lighting family across scenes, e.g. soft hazy dawn, moody cyan practicals, golden-hour backlight",
    "composition_style": "string — recurring framing grammar, lens feel, camera distance tendencies, symmetry/asymmetry",
    "rendering_style": "string — image texture and realism target, e.g. photoreal cinematic, soft film grain, glossy commercial realism",
    "character_consistency": "string — exact recurring appearance rules for main subjects/characters so they do not drift between scenes",
    "environment_consistency": "string — recurring world details that should remain stable across scenes, even as locations evolve",
    "mood_progression": "string — how the visual mood should evolve from hook to reveal without breaking continuity",
    "negative_guardrails": "string — things the image generator must avoid so style does not drift"
  },
  "scenes": [
    {
      "id": 1,
      "act": "hook",
      "duration": 8,
      "narration": "string (ภาษา ${input.language}, ~${targetWords} words, scene connector included)",
      "visual_prompt": "string (English — cinematic overview of the scene: setting, atmosphere, overall visual world. Include location, time of day, and overall feel. IMPORTANT: if named characters appear, describe their visual appearance here — hair color, outfit, distinguishing features — do NOT use character names alone)",
      "subject": "string (English — the primary subject in this clip with FULL VISUAL DESCRIPTION. For known characters (anime, movie, game): describe hair color, eye color, outfit, build, and distinctive features explicitly. e.g. 'A young boy with spiky blonde hair, blue eyes, orange ninja jumpsuit with whisker-like marks on his cheeks' — NOT just 'Naruto')",
      "action": "string (English — REQUIRED. Describe the PHYSICAL action that happens in this exact 8-second clip. Must be VERB-FIRST, specific, and cinematic. Show start-state → movement/change → end-state. NEVER abstract ('conveys emotion') or static ('sits there'). Examples: 'A hand slowly slides a thick stack of rejection letters off a desk; they scatter across the floor one by one' | 'The crowd parts as a lone figure walks forward, camera tracking at shoulder height' | 'A time-lapse of a plant breaking through concrete, cracks spreading outward in real-time' | 'Two people reach for the same document simultaneously — their hands freeze mid-air, eyes locking' | 'Numbers on a financial dashboard flip rapidly from green to red, the glow reflecting off a sweating face')",
      "composition": "string (English — frame layout, e.g. 'centered symmetrical, subject in lower third, deep perspective lines receding to a vanishing point')",
      "lighting": "string (English — ambiance and lighting, e.g. 'cool blue underlit with volumetric haze, single overhead spotlight casting long shadows')",
      "negative_prompt": "string (what NOT to show)",
      "camera_motion": "string (shot type + movement, e.g. 'ultra-wide low-angle slow dolly-in, slight upward tilt as action peaks')",
      "mood": "string (emotional tone, e.g. 'tense, warm, melancholic, triumphant')",
      "focal_point": "string (FOR VIDEO COMPOSITION — where should viewer attention be concentrated in this frame? e.g. 'subject's face in upper-right quadrant with golden ratio balance', 'action happening center-frame with dramatic depth blur on background', 'specific object/emotion emphasized via leading lines or color contrast'. This guides Stage 2 image generation to create visually striking frames suitable for video clips, not scattered attention.)"
    }
  ],
  "total_scenes": ${sceneCount},
  "estimated_duration_seconds": ${sceneCount * 8},
  "music_mood": "string (short summary, fallback only)",
  "social_meta": {
    "video_title": "string — punchy, platform-optimised title (max 60 chars) for YouTube/TikTok/Instagram. Hook-first, written in ${input.language}",
    "description": "string — 2–3 sentence caption/description. Summarise what the video is about and why it matters. Written in ${input.language}",
    "hashtags": ["array of 5-10 topic-relevant hashtag strings including the # prefix, e.g. \"#AI\", \"#เทคโนโลยี\" — do NOT include brand/channel tags here"]
  },
  "directors_brief": {
    "voiceover": {
      "narratorPersona": "string — who is the narrator? e.g. 'a warm, slightly mysterious Thai storyteller in their 30s'",
      "emotionalArc": "string — how should the narrator's emotion evolve? e.g. 'start intrigued → grow concerned → arrive at calm clarity'",
      "deliveryStyle": "string — overall delivery style e.g. 'conversational, not too formal; slower and heavier on BUT act scenes'",
      "pacing": "string — pacing notes e.g. 'medium pace, pause 0.5s after each scene transition, speed up during reveals'",
      "accent": "string — language/accent guidance e.g. 'neutral ${input.language}, clear articulation, avoid filler sounds'",
      "recommendedVoice": "string (REQUIRED) — AI-selected voice name from: Zephyr (Female, Bright), Puck (Male, Upbeat), Charon (Male, Informative), Kore (Female, Firm), Fenrir (Male, Excitable), Leda (Female, Youthful), Orus (Male, Firm), Aoede (Female, Breezy), Callirrhoe (Female, Easy-going), Autonoe (Female, Bright), Enceladus (Male, Breathy), Iapetus (Male, Clear), Umbriel (Male, Easy-going), Algieba (Female, Smooth), Despina (Female, Smooth), Erinome (Female, Clear), Algenib (Male, Gravelly), Rasalgethi (Male, Informative), Laomedeia (Female, Upbeat), Achernar (Male, Soft), Alnilam (Male, Firm), Schedar (Female, Even), Gacrux (Male, Mature), Pulcherrima (Female, Forward), Achird (Female, Friendly), Zubenelgenubi (Male, Casual), Vindemiatrix (Female, Gentle), Sadachbia (Female, Lively), Sadaltager (Male, Knowledgeable), Sulafat (Female, Warm). Choose based on: (1) main character gender if story follows a character, (2) narrator persona tone (e.g. 'Firm' for authoritative, 'Warm' for comforting, 'Informative' for educational), (3) content mood (e.g. 'Upbeat' for positive stories, 'Breathy' for intimate/personal). Return ONLY the voice name (e.g. 'Kore')"
    },
    "music": {
      "genre": "string — music genre that fits the narrative e.g. 'cinematic electronic', 'ambient lo-fi', 'orchestral drama'",
      "tempo": "string — tempo matching the pacing e.g. 'medium 90 BPM, builds in BUT act'",
      "instruments": "string — key instruments e.g. 'piano, light strings, subtle electronic pulse, no drums in HOOK'",
      "moodArc": "string — how music mood should progress e.g. 'mysterious opening → tension building → triumphant resolution'",
      "promptText": "string — FULL ready-to-use music generation prompt (2-3 sentences) combining all music details for Lyria AI"
    }
  }
}

"act" must be one of: "hook" | "context" | "but" | "reveal"
"duration" must be exactly: 8
  `.trim();
}

// ─── Service ──────────────────────────────────────────────────────────────────

export async function generateStoryboard(
  projectId: string,
  prompt: string,
  onProgress: (msg: string) => void,
  model = 'gemini-2.5-flash'
): Promise<Storyboard> {
  const startTime = Date.now();

  onProgress('Calling Gemini 2.5 Flash...');

  const project = await ProjectModel.findById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);

  const attemptNumber = (project.stages.storyboard.attempts?.length ?? 0) + 1;

  let storyboard: Storyboard;
  let rawText = '';

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });

    inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
    totalTokens = response.usageMetadata?.totalTokenCount ?? (inputTokens + outputTokens);

    rawText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!rawText) throw new Error('Empty response from Gemini');

    // Strip any accidental code fences
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed: unknown = JSON.parse(cleaned);

    const validated = StoryboardSchema.parse(parsed);

    // Map snake_case AI output → camelCase Storyboard type
    const aiHashtags = (validated.social_meta?.hashtags ?? []).map((h: string) =>
      h.startsWith('#') ? h : `#${h}`
    );
    // Merge AI tags with defaults — deduplicate by lowercased value
    const mergedHashtags = [...aiHashtags];
    for (const tag of DEFAULT_HASHTAGS) {
      if (!mergedHashtags.some(h => h.toLowerCase() === tag.toLowerCase())) {
        mergedHashtags.push(tag);
      }
    }

    storyboard = {
      title: validated.title,
      hook: validated.hook,
      scenes: validated.scenes,
      total_scenes: validated.total_scenes,
      estimated_duration_seconds: validated.estimated_duration_seconds,
      music_mood: validated.music_mood,
      ...(validated.image_style_brief ? { imageStyleBrief: mapImageStyleBrief(validated.image_style_brief) } : {}),
      ...(validated.directors_brief ? { directorsBrief: validated.directors_brief } : {}),
      ...(validated.social_meta ? {
        socialMeta: {
          videoTitle: validated.social_meta.video_title,
          description: validated.social_meta.description,
          hashtags: mergedHashtags,
        },
      } : {}),
    } as Storyboard;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await ProjectModel.findByIdAndUpdate(projectId, {
      'stages.storyboard.status': 'failed',
      'stages.storyboard.error': message,
    });

    await GenerationLogModel.create({
      projectId,
      stageKey: 'storyboard',
      attemptNumber,
      promptUsed: prompt,
      modelUsed: model,
      status: 'failed',
      outputPaths: [],
      error: message,
      durationMs: Date.now() - startTime,
      costUSD: 0,
    });

    throw err;
  }

  const durationMs = Date.now() - startTime;
  const costUSD = 0.001;

  onProgress(`Storyboard ready: ${storyboard.scenes.length} scenes`);

  // Update MongoDB
  await ProjectModel.findByIdAndUpdate(projectId, {
    'stages.storyboard.status': 'review',
    'stages.storyboard.result': storyboard,
    'stages.storyboard.reviewData': {
      metadata: {
        sceneCount: storyboard.scenes.length,
        estimatedDuration: storyboard.estimated_duration_seconds,
      },
    },
    $push: {
      'stages.storyboard.attempts': {
        attemptNumber,
        promptUsed: prompt,
        outputPaths: [],
        costUSD,
        inputTokens,
        outputTokens,
        totalTokens,
        durationMs,
        createdAt: new Date(),
      },
    },
    $inc: { costUSD },
  });

  // Write generation log
  await GenerationLogModel.create({
    projectId,
    stageKey: 'storyboard',
    attemptNumber,
    promptUsed: prompt,
    modelUsed: model,
    status: 'success',
    outputPaths: [],
    durationMs,
    costUSD,
    inputTokens,
    outputTokens,
    totalTokens,
  });

  return storyboard;
}
