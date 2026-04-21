import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Platform, Duration, Style, Language, Voice, CreateProjectResponse } from '@content-creator/shared';
import { api } from '../api/client.ts';
import { CostBadge } from '../components/CostBadge.tsx';

interface ProjectSummary {
  _id: string;
  title: string;
  status: string;
  costUSD: number;
  estimatedCostUSD: number;
  createdAt: string;
}

const PLATFORMS: Platform[] = ['youtube', 'tiktok', 'instagram', 'linkedin'];
const DURATIONS: Duration[] = ['30s', '60s', '3min'];
const STYLES: Style[] = ['cinematic', 'educational', 'promotional', 'documentary'];
const LANGUAGES: Language[] = ['en', 'th', 'ja', 'zh', 'ko'];
const VOICES: Voice[] = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'];

export default function Home() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form state
  const [topic, setTopic] = useState('');
  const [platform, setPlatform] = useState<Platform>('youtube');
  const [duration, setDuration] = useState<Duration>('60s');
  const [style, setStyle] = useState<Style>('cinematic');
  const [language, setLanguage] = useState<Language>('en');
  const [voice, setVoice] = useState<Voice>('Puck');
  const [includeMusic, setIncludeMusic] = useState(true);

  useEffect(() => {
    api.listProjects()
      .then(data => setProjects(data as ProjectSummary[]))
      .catch(console.error);
  }, []);

  async function handleCreate() {
    if (!topic.trim()) {
      setError('Topic is required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const resp = await api.createProject({
        topic,
        platform,
        duration,
        style,
        language,
        voice,
        includeMusic,
      }) as CreateProjectResponse;
      navigate(`/projects/${resp.projectId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">AI Video Creator</h1>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700"
        >
          + New Project
        </button>
      </header>

      {/* Project list */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {projects.length === 0 ? (
          <div className="text-center py-24 text-gray-400">
            <p className="text-lg">No projects yet.</p>
            <p className="text-sm mt-1">Click "New Project" to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {projects.map(p => (
              <div
                key={p._id}
                onClick={() => navigate(`/projects/${p._id}`)}
                className="rounded-xl bg-white border border-gray-200 px-4 py-3 flex items-center justify-between cursor-pointer hover:border-blue-400 transition-colors"
              >
                <div>
                  <p className="font-medium text-gray-800">{p.title || 'Untitled'}</p>
                  <p className="text-xs text-gray-400">{new Date(p.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-3">
                  <CostBadge usd={p.costUSD > 0 ? p.costUSD : p.estimatedCostUSD} label={p.costUSD > 0 ? 'actual' : 'est.'} />
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    p.status === 'completed' ? 'bg-green-100 text-green-700' :
                    p.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-500'
                  }`}>{p.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* New project modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">New Project</h2>
              <button onClick={() => { setShowModal(false); setError(null); }} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">{error}</div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Topic / Idea</label>
                <textarea
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  rows={3}
                  placeholder="Describe your video idea…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Platform" value={platform} onChange={v => setPlatform(v as Platform)} options={PLATFORMS} />
                <SelectField label="Duration" value={duration} onChange={v => setDuration(v as Duration)} options={DURATIONS} />
                <SelectField label="Style" value={style} onChange={v => setStyle(v as Style)} options={STYLES} />
                <SelectField label="Language" value={language} onChange={v => setLanguage(v as Language)} options={LANGUAGES} />
                <SelectField label="Voice" value={voice} onChange={v => setVoice(v as Voice)} options={VOICES} />
                <div className="flex items-center gap-2 pt-4">
                  <input
                    type="checkbox"
                    id="includeMusic"
                    checked={includeMusic}
                    onChange={e => setIncludeMusic(e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="includeMusic" className="text-sm text-gray-700">Include music</label>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { setShowModal(false); setError(null); }}
                className="rounded-lg border border-gray-300 text-gray-600 px-4 py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Creating…' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
