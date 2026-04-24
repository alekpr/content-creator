**Niche Finder Module**

Development Plan & Integration Specification

content-creator / alekpr

April 2026

**Repo:** https://github.com/alekpr/content-creator

**Stack:** Node.js + TypeScript \| Express.js v5 \| MongoDB 7 \| React 18 + Vite \| Zustand \| Tailwind CSS

**Target:** เพิ่ม Niche Finder Module เข้ากับ Pipeline ที่มีอยู่ (Stage 0 ก่อน Storyboard)

**1. Executive Summary**

ปัจจุบัน content-creator รองรับ workflow ตั้งแต่ Stage 1 (Storyboard) ถึง Stage 6 (Assembly) โดยผู้ใช้ต้องกรอก topic เองตั้งแต่ต้น แผนงานนี้เสนอการเพิ่ม Niche Finder Module ซึ่งทำหน้าที่เป็น \"Stage 0\" ช่วยให้ผู้ใช้ค้นหาและวิเคราะห์ Niche ที่เหมาะสมก่อนเริ่ม Pipeline จริง ผลลัพธ์จาก Stage 0 จะถูกส่งต่อเป็น pre-filled input ให้ Stage 1 โดยอัตโนมัติ

**ประโยชน์หลัก:**

- ลด friction ของการเริ่มต้น --- ผู้ใช้ไม่ต้องคิด topic เอง

- เพิ่มโอกาสสร้างรายได้ --- Niche ที่วิเคราะห์ด้วยข้อมูลจริงมี RPM สูงกว่า

- Reuse architecture เดิมทั้งหมด --- ใช้ MongoDB schema, Express routes, React patterns เดิม

- ไม่กระทบ Pipeline ที่มีอยู่ --- เป็น optional entry point ไม่ใช่ breaking change

**2. Architecture Overview**

Niche Finder จะถูกเพิ่มเป็น optional entry point ก่อน pipeline ที่มีอยู่ เพื่อไม่ให้กระทบ flow เดิม:

\[Niche Finder UI\] → POST /api/niches/analyze → NicheService (Gemini)

↓

\[Niche Result Page\] → \"Use this Niche\" → POST /api/projects (pre-filled)

↓

Stage 1 Storyboard → Stage 2 Images → \... → Stage 6 Assembly

Niche Finder ไม่ได้เปลี่ยน pipeline เดิม แต่เพิ่ม entry point ใหม่ที่ส่งข้อมูลมาที่ POST /api/projects ซึ่ง endpoint นี้มีอยู่แล้ว

**3. ไฟล์ที่ต้องสร้างใหม่**

**3.1 Backend --- New Files**

  --------------------------------------------------------------------------------------------------------------
  **งาน / Task**           **ไฟล์ / Location**         **Priority**  **หมายเหตุ**
  ------------------------ ------------------------- -------------- --------------------------------------------
  NicheAnalysis.model.ts   backend/src/models/          **High**    Mongoose schema สำหรับเก็บผล niche analysis

  niches.router.ts         backend/src/routes/          **High**    REST endpoints สำหรับ niche operations

  NicheService.ts          backend/src/services/        **High**    Gemini API calls สำหรับวิเคราะห์ niche

  niche.validator.ts       backend/src/middleware/     **Medium**   Zod schema validation สำหรับ niche requests
  --------------------------------------------------------------------------------------------------------------

**3.2 Frontend --- New Files**

  ---------------------------------------------------------------------------------------------------------------------
  **งาน / Task**           **ไฟล์ / Location**                **Priority**  **หมายเหตุ**
  ------------------------ -------------------------------- -------------- --------------------------------------------
  NicheFinder.tsx          frontend/src/pages/                 **High**    Main page --- form input + results display

  NicheCard.tsx            frontend/src/components/Niche/      **High**    Card แสดงผล niche แต่ละรายการ

  NicheScoreBar.tsx        frontend/src/components/Niche/     **Medium**   Visual score bar component

  useNicheAnalysis.ts      frontend/src/hooks/                 **High**    Custom hook สำหรับ niche API calls

  nicheStore.ts            frontend/src/store/                **Medium**   Zustand store สำหรับ niche state
  ---------------------------------------------------------------------------------------------------------------------

**3.3 Shared Types --- Additions to shared/src/index.ts**

  --------------------------------------------------------------------------------------------------------
  **งาน / Task**            **ไฟล์ / Location**     **Priority**  **หมายเหตุ**
  ------------------------- --------------------- -------------- -----------------------------------------
  NicheInput interface      shared/src/index.ts      **High**    Input type สำหรับ niche analysis request

  NicheResult interface     shared/src/index.ts      **High**    Output type ของ niche analysis

  NicheAnalysisResponse     shared/src/index.ts      **High**    API response wrapper

  Platform type extension   shared/src/index.ts      **Low**     ถ้าต้องการเพิ่ม platform ใหม่
  --------------------------------------------------------------------------------------------------------

**4. ไฟล์ที่ต้องแก้ไข**

  ---------------------------------------------------------------------------------------------------------------
  **งาน / Task**           **ไฟล์ / Location**     **Priority**  **หมายเหตุ**
  ------------------------ --------------------- -------------- -------------------------------------------------
  app.ts                   backend/src/             **High**    Register niches.router ใน Express app

  Home.tsx                 frontend/src/pages/      **High**    เพิ่มปุ่ม \"Find Niche\" นำไปยัง /niche-finder

  main.tsx / App.tsx       frontend/src/            **High**    เพิ่ม Route /niche-finder → NicheFinder component

  docker-compose.yml       root                     **Low**     ไม่ต้องแก้ --- ใช้ services เดิมทั้งหมด

  backend/.env.example     backend/                 **Low**     อาจเพิ่ม NICHE_CACHE_TTL_HOURS สำหรับ cache config
  ---------------------------------------------------------------------------------------------------------------

**5. Data Model --- NicheAnalysis**

เพิ่ม collection ใหม่ใน MongoDB ชื่อ niches โดย reuse pattern เดิมจาก Project.model.ts:

**5.1 NicheInput (Request Body)**

  ---------------------------------------------------------------------------------------------------------------------------------------------------------
  **Field**         **Type**                                                  **Description**
  ----------------- --------------------------------------------------------- -----------------------------------------------------------------------------
  **interests**     string                                                    ความสนใจ/ความเชี่ยวชาญของผู้ใช้ (เช่น \"การเงิน, ท่องเที่ยว\")

  **platforms**     Platform\[\]                                              แพลตฟอร์มเป้าหมาย: \'youtube\' \| \'tiktok\' \| \'instagram\' \| \'linkedin\'

  **timePerWeek**   \'low\' \| \'mid\' \| \'high\'                            เวลาว่างต่อสัปดาห์: \< 5h / 5--15h / \> 15h

  **goal**          \'income\' \| \'passive\' \| \'affiliate\' \| \'brand\'   เป้าหมายหลักของผู้ใช้

  **budgetTHB**     number                                                    งบประมาณรายเดือน (บาท) --- 0, 500, 2000, 5000

  **language**      Language                                                  ภาษาที่ใช้: \'th\' \| \'en\' (reuse type เดิมจาก shared)

  **market**        \'thai\' \| \'global\' \| \'both\'                        ตลาดเป้าหมาย
  ---------------------------------------------------------------------------------------------------------------------------------------------------------

**5.2 NicheResult (Per-Niche Output)**

  -------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Field**                 **Type**                                     **Description**
  ------------------------- -------------------------------------------- --------------------------------------------------------------------------------------
  **name**                  string                                       ชื่อ Niche (ภาษาไทย หรือ English ตาม language)

  **description**           string                                       คำอธิบาย 1--2 ประโยค

  **rpmRangeTHB**           { min: number; max: number }                 ช่วง RPM ประมาณการในหน่วย THB

  **competition**           \'low\' \| \'medium\' \| \'high\'            ระดับการแข่งขันในตลาด

  **growthTrend**           \'growing\' \| \'stable\' \| \'declining\'   เทรนด์การเติบโต

  **monetizationMethods**   string\[\]                                   วิธีสร้างรายได้ที่แนะนำ (เช่น Affiliate, AdSense, Sponsorship)

  **fitScore**              number                                       คะแนนความเหมาะสม 0--100 คำนวณจาก inputs ของผู้ใช้

  **whyFit**                string                                       เหตุผลที่เหมาะกับ profile นี้

  **contentIdeas**          string\[\]                                   5 หัวข้อวิดีโอแรกที่แนะนำ

  **suggestedTopic**        string                                       Topic ที่แนะนำให้ใช้กับ POST /api/projects (pre-fill Stage 1)

  **suggestedStyle**        Style                                        Style ที่เหมาะ: \'educational\' \| \'promotional\' \| \'documentary\' \| \'cinematic\'
  -------------------------------------------------------------------------------------------------------------------------------------------------------------

**5.3 NicheAnalysisDocument (MongoDB Schema)**

  ----------------------------------------------------------------------------------
  **Field**        **Type**          **Description**
  ---------------- ----------------- -----------------------------------------------
  **\_id**         ObjectId          Auto-generated

  **input**        NicheInput        Input ที่ผู้ใช้กรอก

  **results**      NicheResult\[\]   Array ของ niche ที่วิเคราะห์ได้ (3 รายการ)

  **topPick**      string            ชื่อ niche ที่แนะนำที่สุด

  **tip**          string            คำแนะนำสั้นสำหรับ profile นี้

  **model**        string            Gemini model ที่ใช้ (reuse StoryboardModel type)

  **costUSD**      number            ค่าใช้จ่าย Gemini API (token cost)

  **durationMs**   number            เวลาที่ใช้วิเคราะห์ (milliseconds)

  **createdAt**    Date              Timestamp (auto via timestamps: true)
  ----------------------------------------------------------------------------------

**6. API Endpoints**

ทั้งหมดอยู่ใน niches.router.ts และ mount ที่ /api/niches ใน app.ts:

  ----------------------------------------------------------------------------------------------------------
   **Method**  **Endpoint**           **Description**
  ------------ ---------------------- ----------------------------------------------------------------------
    **POST**   /api/niches/analyze    วิเคราะห์ niche ด้วย Gemini --- รับ NicheInput, คืน NicheAnalysisDocument

    **GET**    /api/niches            ดูประวัติ niche analysis ทั้งหมด (pagination)

    **GET**    /api/niches/:id        ดูผล niche analysis ตาม ID

   **DELETE**  /api/niches/:id        ลบ niche analysis

    **POST**   /api/niches/:id/use    สร้าง project ใหม่จาก niche ที่เลือก → redirect ไป /projects/:projectId
  ----------------------------------------------------------------------------------------------------------

**6.1 POST /api/niches/analyze --- Request / Response**

Request body (validated ด้วย Zod):

{ interests: string, platforms: Platform\[\], timePerWeek: \"low\"\|\"mid\"\|\"high\",

goal: \"income\"\|\"passive\"\|\"affiliate\"\|\"brand\", budgetTHB: number,

language: \"th\"\|\"en\", market: \"thai\"\|\"global\"\|\"both\" }

Response 201:

{ id: string, topPick: string, results: NicheResult\[3\], tip: string,

costUSD: number, durationMs: number, createdAt: string }

**6.2 POST /api/niches/:id/use --- Bridge to Project Pipeline**

เป็น endpoint ที่เชื่อม Niche Finder กับ pipeline เดิม:

- รับ body: { nicheIndex: number } เพื่อระบุว่าเลือก niche ไหน (0--2)

- ดึง NicheAnalysisDocument ตาม id

- Map ข้อมูลไปเป็น ProjectInput:

<!-- -->

- topic ← result.suggestedTopic

- style ← result.suggestedStyle

- platform ← input.platforms\[0\]

- language, voice, duration, includeMusic ← defaults

<!-- -->

- Call POST /api/projects internally → คืน { projectId, redirectUrl }

**7. Gemini Integration --- NicheService.ts**

Reuse pattern เดิมจาก backend/src/services/gemini.ts และ stage1-storyboard.ts:

**7.1 Model ที่ใช้**

- gemini-2.5-flash (default) --- เหมาะสำหรับ JSON structured output, cost \~\$0.001

- gemini-2.5-pro (optional) --- สำหรับ analysis ที่ละเอียดกว่า

**7.2 System Prompt Pattern**

ส่ง JSON mode เหมือน Stage 1 storyboard:

// reuse pattern จาก stage1-storyboard.ts

const response = await gemini.generateContent({

model: \"gemini-2.5-flash\",

generationConfig: { responseMimeType: \"application/json\" },

contents: \[{ role: \"user\", parts: \[{ text: buildNichePrompt(input) }\] }\],

});

ตัวอย่าง prompt structure ที่ส่งให้ Gemini:

You are a Faceless Video content strategy expert for the Thai market.

Analyze the user profile and return ONLY valid JSON matching this schema: { niches: \[\...\] }

User: interests=\"\${interests}\", platforms=\${platforms}, timePerWeek=\${timePerWeek},

goal=\${goal}, budgetTHB=\${budgetTHB}, language=\${language}, market=\${market}

**7.3 Cost Tracking**

Track cost เหมือน pipeline stages เดิม โดย reuse CostCalculator utility:

- เก็บ inputTokens, outputTokens, totalTokens ใน NicheAnalysisDocument

- คำนวณ costUSD จาก Gemini pricing (Flash: \$0.075 per 1M input tokens)

- แสดงผลใน NicheFinder UI เหมือน cost tracking ของ stages

**8. Frontend Integration**

**8.1 Route Setup (App.tsx / main.tsx)**

เพิ่ม route ใหม่โดยใช้ React Router v6 เดิม:

// App.tsx --- เพิ่มเข้าไปใน Routes

\<Route path=\"/niche-finder\" element={\<NicheFinder /\>} /\>

**8.2 Home Page (Home.tsx)**

เพิ่มปุ่ม \"Find Your Niche\" ในหน้าแรก เหนือปุ่ม New Project:

// Home.tsx --- เพิ่ม link/button

\<Link to=\"/niche-finder\"\>

\<button className=\"\...tailwind classes\...\"\>Find Your Niche\</button\>

\</Link\>

**8.3 Zustand Store (nicheStore.ts)**

Pattern เดียวกับ useProject store ที่มีอยู่:

interface NicheStore {

analysis: NicheAnalysisDocument \| null;

isLoading: boolean;

error: string \| null;

analyze: (input: NicheInput) =\> Promise\<void\>;

reset: () =\> void;

}

**8.4 NicheFinder Page (NicheFinder.tsx)**

UI มี 2 state หลัก คือ Form View (ก่อน submit) และ Results View (หลัง submit):

Form View --- fields ที่ต้องมี:

- interests: text input

- platforms: multi-select chips (reuse Tailwind pattern เดิม)

- timePerWeek: radio/chips

- goal: radio/chips

- budgetTHB: slider หรือ select

- language: select (th / en)

Results View --- แสดง NicheResult array:

- NicheCard x3 --- แต่ละ card แสดง name, description, fitScore, rpmRange, competition, contentIdeas

- \"Use this Niche\" button --- call POST /api/niches/:id/use แล้ว navigate ไป /projects/:projectId

- Cost & duration แสดงเล็กๆ ด้านล่าง (reuse pattern จาก cost tracking เดิม)

**9. Integration Flow (End-to-End)**

ลำดับการทำงานตั้งแต่ผู้ใช้เปิดหน้า NicheFinder จนถึงเริ่ม Stage 1:

  -------------------------------------------------------------------------------------------------------
  **\#**   **ผู้ส่ง (Source)**        **ข้อมูล (Data)**                      **ผู้รับ (Target)**
  -------- ----------------------- ------------------------------------ ---------------------------------
  **1**    User → NicheFinder UI   NicheInput form data                 POST /api/niches/analyze

  **2**    NicheService            Structured prompt (JSON mode)        Gemini 2.5 Flash API

  **3**    Gemini API              NicheResult\[3\] JSON                NicheService (parse + validate)

  **4**    NicheService            NicheAnalysisDocument                MongoDB niches collection

  **5**    Backend                 Response 201 + analysis data         Frontend (React)

  **6**    User                    เลือก Niche + กด \"Use this Niche\"   POST /api/niches/:id/use

  **7**    niches.router           Map niche → ProjectInput             POST /api/projects (existing)

  **8**    projects.router         ProjectDocument created              Navigate to /projects/:id

  **9**    Stage 1 Storyboard      Auto pre-filled topic + style        ดำเนิน Pipeline ปกติ
  -------------------------------------------------------------------------------------------------------

**10. Development Phases**

  ------------- ------------------------------------------------ -------------
   **Phase 1**  **Backend Core --- Model, Service, Routes**          \~1--2 วัน

  ------------- ------------------------------------------------ -------------

**10.1.1 NicheAnalysis.model.ts**

- สร้าง Mongoose schema ตาม NicheInput + NicheResult + document fields

- เพิ่ม index: { createdAt: -1 } เหมือน ProjectSchema

- Export NicheAnalysisModel

**10.1.2 NicheService.ts**

- Copy pattern จาก services/gemini.ts สำหรับ client initialization

- สร้าง buildNichePrompt(input: NicheInput): string

- สร้าง analyzeNiche(input: NicheInput): Promise\<NicheAnalysisDocument\>

- Track cost เหมือน stage services เดิม

**10.1.3 niches.router.ts**

- POST /analyze --- validate (Zod) → NicheService.analyzeNiche → save → return 201

- GET / --- ดูประวัติ analysis (ใช้ pagination pattern เดิม)

- GET /:id --- ดู analysis ตาม id

- DELETE /:id --- ลบ

- POST /:id/use --- map niche → ProjectInput → POST /api/projects

**10.1.4 Register Router ใน app.ts**

app.use(\'/api/niches\', nichesRouter);

  ------------- ------------------------------------------------ -------------
   **Phase 2**  **Shared Types**                                      \~0.5 วัน

  ------------- ------------------------------------------------ -------------

- เพิ่ม NicheInput, NicheResult, NicheAnalysisResponse ใน shared/src/index.ts

- Run npm run build \--workspace=shared เพื่อ compile

- ตรวจสอบ TypeScript types ใน backend และ frontend ถูกต้อง

  ------------- ------------------------------------------------ -------------
   **Phase 3**  **Frontend --- Store + Hooks + UI**                  \~2--3 วัน

  ------------- ------------------------------------------------ -------------

**10.3.1 nicheStore.ts (Zustand)**

- สร้าง store pattern เดิมตาม useProject store

- State: analysis, isLoading, error

- Actions: analyze(input), reset()

**10.3.2 useNicheAnalysis.ts**

- Custom hook ที่ wrap nicheStore

- Handle optimistic UI และ error states

**10.3.3 NicheCard.tsx**

- Props: result: NicheResult, isTop: boolean, onUse: () =\> void

- แสดง fitScore ด้วย visual bar (reuse Tailwind)

- แสดง rpmRange, competition badge, contentIdeas list

- \"Use this Niche\" button → call onUse callback

**10.3.4 NicheFinder.tsx (Main Page)**

- Form state → submit → Results state (2 views)

- Loading state ด้วย animation เหมือน generating stages

- Error handling เหมือน stage error panel เดิม

**10.3.5 Route + Navigation**

- เพิ่ม /niche-finder route ใน App.tsx

- เพิ่มปุ่ม \"Find Your Niche\" ใน Home.tsx

  ------------- ------------------------------------------------ -------------
   **Phase 4**  **Testing & Polish**                                    \~1 วัน

  ------------- ------------------------------------------------ -------------

- ทดสอบ end-to-end: NicheFinder → Use → Project Stage 1 ถูกต้อง

- ทดสอบ error cases: Gemini API fail, invalid input, network error

- ทดสอบ cost tracking แสดงผลถูกต้อง

- ทดสอบ mobile viewport (9:16 platform selection)

- Code review: TypeScript types ครบ, Zod validation ครบ

**11. WebSocket Events (Optional Enhancement)**

ถ้าต้องการ streaming progress สำหรับ Niche analysis (เหมาะถ้า analysis ใช้เวลานาน) สามารถ reuse Socket.io pattern เดิมได้:

  -----------------------------------------------------------------------------------------
  **Event**             **Payload**
  --------------------- -------------------------------------------------------------------
  **niche:analyzing**   { analysisId: string, message: string, percent: number }

  **niche:result**      { analysisId: string, results: NicheResult\[\], topPick: string }

  **niche:error**       { analysisId: string, error: string }
  -----------------------------------------------------------------------------------------

หมายเหตุ: สำหรับ MVP ไม่จำเป็นต้องมี WebSocket เพราะ Gemini Flash response เร็ว (\~2--5 วินาที) ใช้ polling หรือ async/await ปกติได้

**12. Environment & Configuration**

ไม่ต้องเพิ่ม API key ใหม่ --- Niche Finder reuse GEMINI_API_KEY เดิมทั้งหมด:

**Optional --- เพิ่มใน backend/.env**

\# Niche Finder config (optional --- ถ้าไม่ระบุ ใช้ default)

NICHE_MODEL=gemini-2.5-flash \# model สำหรับ niche analysis

NICHE_CACHE_TTL_HOURS=24 \# cache analysis ที่ input เหมือนกัน

NICHE_MAX_RESULTS=3 \# จำนวน niche ต่อการ analyze

Docker: ไม่ต้องแก้ docker-compose.yml เพราะใช้ MongoDB และ Redis เดิม

**13. Future Enhancements (Post-MVP)**

**Phase 5 --- Trend Data Integration**

- เพิ่ม Google Trends API เพื่อดึงข้อมูล search volume จริง แทนที่การ estimate ด้วย Gemini

- เพิ่ม TikTok Creative Center API เพื่อดูข้อมูล trending hashtags และ niche performance

- เก็บ trend data ใน MongoDB เป็น time-series สำหรับ historical comparison

**Phase 6 --- Competitor Analysis**

- ดึงข้อมูล top channels ใน niche จาก YouTube Data API

- วิเคราะห์ gap หัวข้อที่ยังไม่มีคนทำ

- แสดง estimated monthly revenue ของ channels ที่ใกล้เคียง

**Phase 7 --- Saved Niches & History**

- ให้ผู้ใช้ bookmark niche ที่ชอบ

- เปรียบเทียบ niche หลายตัวพร้อมกันใน comparison view

- Track niche performance หลังจาก publish videos

**14. Summary Checklist**

  ----------------------------------------------------------------------------
          **Task**                                   **Phase**     **Status**
  ------- ------------------------------------------ ------------ ------------
  \[ \]   NicheAnalysis.model.ts                     **1**          **TODO**

  \[ \]   NicheService.ts + Gemini integration       **1**          **TODO**

  \[ \]   niches.router.ts (5 endpoints)             **1**          **TODO**

  \[ \]   Register router ใน app.ts                  **1**          **TODO**

  \[ \]   Shared types ใน shared/src/index.ts        **2**          **TODO**

  \[ \]   nicheStore.ts (Zustand)                    **3**          **TODO**

  \[ \]   useNicheAnalysis.ts hook                   **3**          **TODO**

  \[ \]   NicheCard.tsx component                    **3**          **TODO**

  \[ \]   NicheFinder.tsx page                       **3**          **TODO**

  \[ \]   Route + Navigation ใน App.tsx + Home.tsx   **3**          **TODO**

  \[ \]   End-to-end testing                         **4**          **TODO**

  \[ \]   Error handling & edge cases                **4**          **TODO**
  ----------------------------------------------------------------------------

content-creator --- Niche Finder Module Plan \| alekpr \| April 2026
