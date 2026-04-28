import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DURATION_VALUES, TTS_VOICE_METADATA } from '@content-creator/shared';
import type { Platform, Language, Duration, Style, Voice, CreateProjectResponse, NicheResult } from '@content-creator/shared';
import { useNicheAnalysis } from '../hooks/useNicheAnalysis.ts';
import { NicheCard } from '../components/Niche/NicheCard.tsx';
import { api } from '../api/client.ts';

const PLATFORMS: Platform[] = ['youtube', 'tiktok', 'instagram', 'linkedin'];
const DURATIONS = DURATION_VALUES;
const STYLES: Style[] = ['cinematic', 'educational', 'promotional', 'documentary'];
const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'th', label: 'Thai' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
];

const GOALS = [
  { value: 'income',    label: 'Ad Income',    desc: 'Maximize CPM/RPM' },
  { value: 'passive',   label: 'Passive Income', desc: 'Low maintenance' },
  { value: 'affiliate', label: 'Affiliate',    desc: 'Product promotions' },
  { value: 'brand',     label: 'Personal Brand', desc: 'Build authority' },
] as const;

const TIME_OPTIONS = [
  { value: 'low',  label: '< 5h/week' },
  { value: 'mid',  label: '5–15h/week' },
  { value: 'high', label: '> 15h/week' },
] as const;

const MARKETS = [
  { value: 'thai',   label: 'Thai Market' },
  { value: 'global', label: 'Global' },
  { value: 'both',   label: 'Both' },
] as const;

const BUDGETS = [
  { value: 0,    label: 'Free only' },
  { value: 500,  label: '฿500/mo' },
  { value: 2000, label: '฿2,000/mo' },
  { value: 5000, label: '฿5,000/mo' },
];

export default function NicheFinder() {
  const navigate = useNavigate();
  const { analysis, isLoading, error, analyze, reset } = useNicheAnalysis();

  // ─── Niche finder form state ──────────────────────────────────────────────
  const [interests, setInterests] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(['youtube']);
  const [timePerWeek, setTimePerWeek] = useState<'low' | 'mid' | 'high'>('mid');
  const [goal, setGoal] = useState<'income' | 'passive' | 'affiliate' | 'brand'>('income');
  const [budgetTHB, setBudgetTHB] = useState(0);
  const [language, setLanguage] = useState<Language>('th');
  const [market, setMarket] = useState<'thai' | 'global' | 'both'>('thai');

  // ─── View state ───────────────────────────────────────────────────────────
  // 'form' → 'results' → 'settings' → navigate to project
  const [view, setView] = useState<'form' | 'results' | 'settings'>('form');
  const [selectedNiche, setSelectedNiche] = useState<NicheResult | null>(null);
  const [selectedNicheIndex, setSelectedNicheIndex] = useState<number>(0);

  // ─── Project settings state (pre-filled from niche) ───────────────────────
  const [projTopic, setProjTopic] = useState('');
  const [projPlatform, setProjPlatform] = useState<Platform>('youtube');
  const [projDuration, setProjDuration] = useState<Duration>('64s');
  const [projStyle, setProjStyle] = useState<Style>('cinematic');
  const [projLanguage, setProjLanguage] = useState<Language>('th');
  const [projVoice, setProjVoice] = useState<Voice>('Puck');
  const [projIncludeMusic, setProjIncludeMusic] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Extra ideas loaded on demand
  const [extraIdeas, setExtraIdeas] = useState<string[]>([]);
  const [loadingMoreIdeas, setLoadingMoreIdeas] = useState(false);

  function togglePlatform(p: Platform) {
    setSelectedPlatforms(prev =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter(x => x !== p) : prev) : [...prev, p]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!interests.trim()) return;
    await analyze({ interests, platforms: selectedPlatforms, timePerWeek, goal, budgetTHB, language, market });
    setView('results');
  }

  function handleSelectNiche(result: NicheResult) {
    const idx = analysis?.results.indexOf(result) ?? 0;
    setSelectedNiche(result);
    setSelectedNicheIndex(idx);
    setExtraIdeas([]);
    // Pre-fill project settings from the niche
    setProjTopic(result.suggestedTopic);
    setProjPlatform(selectedPlatforms[0]);
    setProjStyle(result.suggestedStyle);
    setProjLanguage(language);
    setProjDuration('64s');
    setProjVoice('Puck');
    setProjIncludeMusic(true);
    setCreateError(null);
    setView('settings');
  }

  async function handleLoadMoreIdeas() {
    if (!analysis?.id) return;
    setLoadingMoreIdeas(true);
    try {
      const resp = await api.loadMoreNicheIdeas(analysis.id, selectedNicheIndex) as { ideas: string[] };
      setExtraIdeas(prev => [...prev, ...resp.ideas]);
    } catch {
      // silently ignore; user can retry
    } finally {
      setLoadingMoreIdeas(false);
    }
  }

  async function handleCreateProject() {
    setCreating(true);
    setCreateError(null);
    try {
      const resp = await api.createProject({
        topic: projTopic,
        platform: projPlatform,
        duration: projDuration,
        style: projStyle,
        language: projLanguage,
        voice: projVoice,
        includeMusic: projIncludeMusic,
      }) as CreateProjectResponse;
      navigate(`/projects/${resp.projectId}`);
    } catch (err) {
      setCreateError((err as Error).message);
      setCreating(false);
    }
  }

  function handleResetAll() {
    reset();
    setView('form');
    setSelectedNiche(null);
    setCreateError(null);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {view === 'settings' ? (
            <button onClick={() => setView('results')} className="text-sm text-gray-500 hover:text-gray-700">← Back to Results</button>
          ) : (
            <Link to="/" className="text-sm text-gray-500 hover:text-gray-700">← Back</Link>
          )}
          <h1 className="text-xl font-bold text-gray-900">
            {view === 'form' && 'Find Your Niche'}
            {view === 'results' && 'Niche Results'}
            {view === 'settings' && 'Project Settings'}
          </h1>
        </div>
        {/* Step indicator */}
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <span className={view === 'form' ? 'font-semibold text-purple-600' : 'text-gray-400'}>1. Find</span>
          <span className="mx-1">→</span>
          <span className={view === 'results' ? 'font-semibold text-purple-600' : 'text-gray-400'}>2. Choose</span>
          <span className="mx-1">→</span>
          <span className={view === 'settings' ? 'font-semibold text-purple-600' : 'text-gray-400'}>3. Configure</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {/* ─── Form View ─────────────────────────────────────────────────── */}
        {view === 'form' && (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-5">
              <h2 className="font-semibold text-gray-800">Tell us about yourself</h2>

              {/* Interests */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Interests / Expertise
                </label>
                <input
                  type="text"
                  value={interests}
                  onChange={e => setInterests(e.target.value)}
                  placeholder="e.g. personal finance, travel, cooking, tech reviews"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  required
                />
              </div>

              {/* Platforms */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Target Platforms
                </label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePlatform(p)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        selectedPlatforms.includes(p)
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time per week */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Available Time / Week
                </label>
                <div className="flex gap-2">
                  {TIME_OPTIONS.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTimePerWeek(t.value)}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        timePerWeek === t.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Goal */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Primary Goal
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {GOALS.map(g => (
                    <button
                      key={g.value}
                      type="button"
                      onClick={() => setGoal(g.value)}
                      className={`rounded-lg px-3 py-2 text-left transition-colors ${
                        goal === g.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <div className="text-sm font-medium">{g.label}</div>
                      <div className={`text-xs ${goal === g.value ? 'text-blue-100' : 'text-gray-400'}`}>{g.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Budget */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Monthly Budget
                </label>
                <div className="flex gap-2">
                  {BUDGETS.map(b => (
                    <button
                      key={b.value}
                      type="button"
                      onClick={() => setBudgetTHB(b.value)}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        budgetTHB === b.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Language + Market */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Language</label>
                  <select
                    value={language}
                    onChange={e => setLanguage(e.target.value as Language)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {LANGUAGES.map(l => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Market</label>
                  <div className="flex flex-col gap-1">
                    {MARKETS.map(m => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => setMarket(m.value)}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium text-left transition-colors ${
                          market === m.value
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !interests.trim()}
              className="w-full rounded-lg bg-purple-600 text-white px-4 py-3 text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Analyzing niches…
                </span>
              ) : (
                'Find My Niche →'
              )}
            </button>
          </form>
        )}

        {/* ─── Results View ──────────────────────────────────────────────── */}
        {view === 'results' && analysis && (
          <div className="space-y-6">
            {/* Summary bar */}
            <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">
                  Top Pick: <span className="text-blue-600">{analysis.topPick}</span>
                </p>
                {analysis.tip && (
                  <p className="text-xs text-gray-500 mt-0.5">💡 {analysis.tip}</p>
                )}
              </div>
              <div className="text-right text-xs text-gray-400 font-mono space-y-0.5">
                <div>${analysis.costUSD.toFixed(4)}</div>
                <div>{(analysis.durationMs / 1000).toFixed(1)}s</div>
              </div>
            </div>

            {/* Niche cards */}
            <div className="space-y-4">
              {analysis.results.map((result, i) => (
                <NicheCard
                  key={i}
                  result={result}
                  isTop={result.name === analysis.topPick}
                  onUse={() => handleSelectNiche(result)}
                  isUsing={false}
                />
              ))}
            </div>

            <button
              onClick={handleResetAll}
              className="w-full rounded-lg bg-gray-100 text-gray-600 px-4 py-2 text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              ← Analyze Again
            </button>
          </div>
        )}

        {/* ─── Settings View ─────────────────────────────────────────────── */}
        {view === 'settings' && selectedNiche && (
          <div className="space-y-6">
            {/* Selected niche summary */}
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
              <p className="text-xs font-medium text-blue-500 mb-0.5">Selected Niche</p>
              <p className="font-semibold text-blue-900">{selectedNiche.name}</p>
              <p className="text-xs text-blue-700 mt-0.5">{selectedNiche.description}</p>
            </div>

            {/* Project settings form */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-5">
              <h2 className="font-semibold text-gray-800">Project Settings</h2>
              <p className="text-xs text-gray-500 -mt-3">ปรับแต่ง settings ก่อนสร้างโปรเจค ค่าต่างๆ ถูก pre-fill จาก niche ที่เลือกแล้ว</p>

              {/* Topic / Idea picker */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Topic / Idea</label>
                {/* Idea chips */}
                <div className="flex flex-col gap-1.5 mb-3">
                  {[selectedNiche.suggestedTopic, ...selectedNiche.contentIdeas, ...extraIdeas].map((idea, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setProjTopic(idea)}
                      className={`text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                        projTopic === idea
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {i === 0 && (
                        <span className={`inline-block text-xs font-medium mr-1.5 ${projTopic === idea ? 'text-blue-200' : 'text-blue-500'}`}>
                          ★ suggested
                        </span>
                      )}
                      {idea}
                    </button>
                  ))}
                </div>
                {/* Load more button */}
                <button
                  type="button"
                  onClick={handleLoadMoreIdeas}
                  disabled={loadingMoreIdeas}
                  className="w-full rounded-lg border border-dashed border-purple-300 text-purple-600 px-3 py-2 text-sm font-medium hover:bg-purple-50 disabled:opacity-50 transition-colors mb-3"
                >
                  {loadingMoreIdeas ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="inline-block w-3.5 h-3.5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                      Generating ideas…
                    </span>
                  ) : '+ Load more ideas'}
                </button>
                {/* Free-text override */}
                <p className="text-xs text-gray-400 mb-1">หรือพิมพ์ topic เองได้เลย</p>
                <textarea
                  value={projTopic}
                  onChange={e => setProjTopic(e.target.value)}
                  rows={2}
                  placeholder="พิมพ์ topic ของคุณเอง…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              {/* Platform */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Platform</label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setProjPlatform(p)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                        projPlatform === p ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Duration + Style */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Duration</label>
                  <div className="flex flex-col gap-1">
                    {DURATIONS.map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setProjDuration(d)}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium text-left transition-colors ${
                          projDuration === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Style</label>
                  <div className="flex flex-col gap-1">
                    {STYLES.map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setProjStyle(s)}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium text-left transition-colors ${
                          projStyle === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Language + Voice */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Language</label>
                  <select
                    value={projLanguage}
                    onChange={e => setProjLanguage(e.target.value as Language)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {LANGUAGES.map(l => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Voice</label>
                  <select
                    value={projVoice}
                    onChange={e => setProjVoice(e.target.value as Voice)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {TTS_VOICE_METADATA.map(v => (
                      <option key={v.name} value={v.name}>
                        {v.name} — {v.description} ({v.gender === 'female' ? 'Female' : 'Male'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Include music */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="projIncludeMusic"
                  checked={projIncludeMusic}
                  onChange={e => setProjIncludeMusic(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="projIncludeMusic" className="text-sm text-gray-700">Include background music</label>
              </div>
            </div>

            {createError && (
              <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                {createError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setView('results')}
                disabled={creating}
                className="flex-1 rounded-lg border border-gray-300 text-gray-600 px-4 py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={handleCreateProject}
                disabled={creating || !projTopic.trim()}
                className="flex-[2] rounded-lg bg-blue-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Creating Project…
                  </span>
                ) : (
                  'Create Project →'
                )}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
