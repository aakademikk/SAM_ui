/**
 * /settings — Voice, theme, and device management.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useUserPreferencesStore } from '@/store/userPreferencesStore';
import { authService } from '@/lib/authService';
import {
  VOICE_GROUPS, DEFAULT_VOICE,
  EDGE_VOICE_GROUPS, DEFAULT_EDGE_VOICE,
} from '@/lib/voiceData';
import { AMBIENT_THEMES } from '@/types/dashboard';
import type { SarcasmLevel } from '@/lib/personalityEngine';

export default function SettingsPage() {
  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-8 pb-20">
      <h1 className="text-xl font-bold text-void-100">Settings</h1>
      <ThemeSection />
      <VoiceSection />
      <DeviceSection />
    </div>
  );
}

/* ========================================================================== */
/* Theme                                                                       */
/* ========================================================================== */

function ThemeSection() {
  const theme = useUserPreferencesStore((s) => s.ambientTheme);
  const setTheme = useUserPreferencesStore((s) => s.setAmbientTheme);
  const sarcasm = useUserPreferencesStore((s) => s.sarcasm);
  const setSarcasm = useUserPreferencesStore((s) => s.setSarcasm);

  const SARCASM_LABELS: Record<SarcasmLevel, string> = {
    0: 'Clinical', 1: 'Dry', 2: 'Direct', 3: 'Unfiltered',
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-dim-200 uppercase tracking-wider">Appearance</h2>

      <div className="space-y-2">
        <label className="text-xs text-dim-300">Colour theme</label>
        <div className="flex flex-wrap gap-2">
          {AMBIENT_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                theme === t.id
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-void-700 bg-void-900 text-dim-300 hover:border-void-600'
              }`}
            >
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }}
              />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-dim-300">Sarcasm level</label>
        <div className="flex gap-2">
          {([0, 1, 2, 3] as SarcasmLevel[]).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setSarcasm(level)}
              className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                sarcasm === level
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-void-700 bg-void-900 text-dim-300 hover:border-void-600'
              }`}
            >
              {SARCASM_LABELS[level]}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* Voice                                                                       */
/* ========================================================================== */

function VoiceSection() {
  const [voiceId, setVoiceId] = useState<number>(() => {
    try { return parseInt(localStorage.getItem('sam-tts-voice') ?? String(DEFAULT_VOICE), 10); }
    catch { return DEFAULT_VOICE; }
  });
  const [edgeVoiceId, setEdgeVoiceId] = useState<string>(() => {
    try { return localStorage.getItem('sam-tts-edge-voice') ?? DEFAULT_EDGE_VOICE; }
    catch { return DEFAULT_EDGE_VOICE; }
  });
  const [previewing, setPreviewing] = useState(false);
  const [edgePreviewing, setEdgePreviewing] = useState(false);

  const setVoice = useCallback((id: number) => {
    setVoiceId(id);
    localStorage.setItem('sam-tts-voice', String(id));
  }, []);

  const setEdgeVoice = useCallback((id: string) => {
    setEdgeVoiceId(id);
    localStorage.setItem('sam-tts-edge-voice', id);
  }, []);

  const preview = useCallback(async () => {
    setPreviewing(true);
    try {
      const res = await fetch('/api/chat/tts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello. This is my voice.', voice: voiceId }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        audio.play();
      }
    } catch { /* silent */ }
    finally { setPreviewing(false); }
  }, [voiceId]);

  const edgePreview = useCallback(async () => {
    setEdgePreviewing(true);
    try {
      const res = await fetch('/api/chat/tts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Hello. This is my voice.', edgeVoice: edgeVoiceId }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        audio.play();
      }
    } catch { /* silent */ }
    finally { setEdgePreviewing(false); }
  }, [edgeVoiceId]);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-dim-200 uppercase tracking-wider">Voice</h2>

      <div className="space-y-2">
        <label className="text-xs text-dim-300">TTS voice (Kokoro)</label>
        <select
          value={voiceId}
          onChange={(e) => setVoice(parseInt(e.target.value))}
          className="w-full bg-void-900 border border-void-600 rounded-lg px-3 py-2
                     text-void-100 text-sm focus:border-accent focus:outline-none"
        >
          {VOICE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          onClick={preview}
          disabled={previewing}
          className="px-3 py-1.5 bg-void-800 border border-void-600 rounded-lg
                     text-dim-200 text-xs hover:text-void-100 transition-colors"
        >
          {previewing ? 'Playing...' : 'Preview voice'}
        </button>
      </div>

      <div className="pt-2 space-y-2">
        <label className="text-xs text-dim-300">
          TTS voice (Edge) — used for chat and push-to-talk
        </label>
        <select
          value={edgeVoiceId}
          onChange={(e) => setEdgeVoice(e.target.value)}
          className="w-full bg-void-900 border border-void-600 rounded-lg px-3 py-2
                     text-void-100 text-sm focus:border-accent focus:outline-none"
        >
          {EDGE_VOICE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          onClick={edgePreview}
          disabled={edgePreviewing}
          className="px-3 py-1.5 bg-void-800 border border-void-600 rounded-lg
                     text-dim-200 text-xs hover:text-void-100 transition-colors"
        >
          {edgePreviewing ? 'Playing...' : 'Preview voice'}
        </button>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* Devices                                                                     */
/* ========================================================================== */

interface Device {
  credentialId: string;
  deviceName: string;
  createdAt: string;
}

function DeviceSection() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDevices(await authService.listDevices());
    } catch {
      setError('Not authenticated. Log in to manage devices.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const revoke = async (credentialId: string) => {
    try {
      await authService.revokeDevice(credentialId);
      setDevices((prev) => prev.filter((d) => d.credentialId !== credentialId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed — step-up required.');
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-dim-200 uppercase tracking-wider">Devices</h2>

      {loading && <p className="text-xs text-dim-400">Loading...</p>}
      {error && <p className="text-xs text-amber-400">{error}</p>}

      {devices.length === 0 && !loading && (
        <p className="text-xs text-dim-400">No registered devices.</p>
      )}

      <div className="space-y-2">
        {devices.map((d) => (
          <div
            key={d.credentialId}
            className="flex items-center justify-between p-3 bg-void-900 border border-void-700 rounded-lg"
          >
            <div>
              <p className="text-sm text-dim-100">{d.deviceName}</p>
              <p className="text-[10px] text-dim-400 font-mono">
                {d.credentialId.slice(0, 20)}... · {new Date(d.createdAt).toLocaleDateString()}
              </p>
            </div>
            <button
              type="button"
              onClick={() => revoke(d.credentialId)}
              className="px-3 py-1 text-xs bg-red-900/20 border border-red-700/30 rounded
                         text-red-400 hover:bg-red-900/40 transition-colors"
            >
              Revoke
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
