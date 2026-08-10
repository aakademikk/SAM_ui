/**
 * /chat — Live AI chat with SAM.
 *
 * Streams responses via SSE from the /api/chat endpoint. Supports
 * desktop (sidebar visible) and mobile (bottom tab bar).
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Cpu, Volume2, VolumeX, Play } from 'lucide-react';
import { VoiceRecordButton } from '@/components/voice/VoiceRecordButton';
import { sendMessage as sendCrossTab, readMessage as readCrossTab } from '@/lib/crossTab';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const CHAT_STORAGE_KEY = 'sam-chat-messages';
const MAX_STORED_MESSAGES = 50;

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Message[];
  } catch { /* corrupted */ }
  return [];
}

function saveMessages(msgs: Message[]) {
  try {
    // Keep only the last N to stay within localStorage limits.
    const trimmed = msgs.slice(-MAX_STORED_MESSAGES);
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* quota exceeded */ }
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastAssistantIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Persist messages to localStorage on every change.
  useEffect(() => {
    if (messages.length > 0) saveMessages(messages);
  }, [messages]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // On mount, mark the last assistant message as already spoken so we
  // don't re-speak it when switching tabs.
  useEffect(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && m.content);
    if (lastAssistant) lastAssistantIdRef.current = lastAssistant.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-speak completed assistant messages (only new ones since mount)
  useEffect(() => {
    if (muted) return;
    const last = messages[messages.length - 1];
    if (
      last?.role === 'assistant' &&
      last.content &&
      !streaming &&
      last.id !== lastAssistantIdRef.current
    ) {
      lastAssistantIdRef.current = last.id;
      speak(last.id, last.content);
    }
  }, [messages, streaming, muted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Poll for incoming messages from Terminal
  useEffect(() => {
    const check = () => {
      const msg = readCrossTab('chat');
      if (msg) {
        // Auto-send as a user message
        const userMsg: Message = {
          id: `user_${Date.now()}`,
          role: 'user',
          content: msg,
        };
        setMessages((prev) => [...prev, userMsg]);
      }
    };
    // Check on mount and on storage events
    check();
    window.addEventListener('storage', check);
    return () => window.removeEventListener('storage', check);
  }, []);

  /* ── Helpers ─────────────────────────────────────────────────────────── */

  /** Extract inline code blocks that look like shell commands. */
  const extractCommands = (text: string): string[] => {
    const cmds: string[] = [];
    // Match backtick-wrapped text
    const ticks = text.match(/`([^`]+)`/g);
    if (ticks) {
      for (const t of ticks) {
        const inner = t.slice(1, -1).trim();
        // Heuristic: looks like a shell command
        if (inner.length > 3 && !inner.includes('\n') && /^[a-z]/.test(inner)) {
          cmds.push(inner);
        }
      }
    }
    return cmds;
  };

  const sendToTerminal = (cmd: string) => {
    sendCrossTab({ type: 'command', text: cmd, timestamp: Date.now() });
  };

  /* ── Text-to-speech ──────────────────────────────────────────────────── */

  const speak = useCallback(async (msgId: string, text: string) => {
    // Stop current playback
    audioRef.current?.pause();
    audioRef.current = null;

    if (speaking === msgId) {
      setSpeaking(null);
      return;
    }

    try {
      setSpeaking(msgId);
      const response = await fetch('/api/chat/tts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: parseInt(localStorage.getItem('sam-tts-voice') ?? '21', 10),
        }),
      });

      if (!response.ok) throw new Error('TTS failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        setSpeaking(null);
        URL.revokeObjectURL(url);
        audioRef.current = null;
      };

      audio.onerror = () => {
        setSpeaking(null);
        URL.revokeObjectURL(url);
        audioRef.current = null;
      };

      await audio.play();
    } catch {
      setSpeaking(null);
    }
  }, [speaking]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: text,
    };

    const assistantMsg: Message = {
      id: `assistant_${Date.now()}`,
      role: 'assistant',
      content: '',
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);
    setError(null);

    const allMessages = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: allMessages }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error ?? `HTTP ${response.status}`);
      }

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: delta')) {
            // Next line is the data
            continue;
          }
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.text) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === 'assistant') {
                    last.content += parsed.text;
                  }
                  return [...updated]; // trigger re-render
                });
              }
            } catch { /* skip */ }
          }
          if (line.startsWith('event: error')) {
            continue;
          }
          if (line.startsWith('event: done')) {
            break;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chat failed';
      setError(msg);
      // Remove the empty assistant message on error
      setMessages((prev) => {
        const updated = [...prev];
        if (updated[updated.length - 1]?.role === 'assistant' && !updated[updated.length - 1].content) {
          updated.pop();
        }
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, messages]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:min-h-screen">
      {/* Mute toggle */}
      <div className="flex items-center justify-end px-4 py-1.5 border-b border-void-800 shrink-0">
        <button
          type="button"
          onClick={() => setMuted(!muted)}
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${
            muted
              ? 'text-red-400 bg-red-900/20 border border-red-700/30'
              : 'text-void-400 hover:text-void-200'
          }`}
          title={muted ? 'Unmute SAM' : 'Mute SAM'}
        >
          {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          {muted ? 'Muted' : 'Speaking'}
        </button>
      </div>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto px-3 md:px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-20">
            <Cpu size={32} className="text-accent/40" />
            <h2 className="text-lg font-bold text-void-300">SAM</h2>
            <p className="text-sm text-void-500 max-w-xs">
              Direct, sarcastic, brutally honest. Ask me anything about your systems,
              projects, or what needs attention.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] md:max-w-[70%] rounded-lg px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-accent/15 border border-accent/30 text-void-100'
                  : 'bg-void-800 border border-void-700 text-void-200'
              }`}
            >
              {msg.content || (msg.role === 'assistant' && streaming ? (
                <span className="inline-block w-2 h-4 bg-accent animate-pulse align-text-bottom" />
              ) : null)}

              {/* Run-command button on messages containing shell commands */}
              {msg.role === 'assistant' && msg.content && extractCommands(msg.content).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {extractCommands(msg.content).slice(0, 3).map((cmd, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => sendToTerminal(cmd)}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] bg-accent/10
                                 border border-accent/20 rounded text-accent hover:bg-accent/20
                                 transition-colors"
                      title={`Run in Terminal: ${cmd}`}
                    >
                      <Play size={10} />
                      <code className="truncate max-w-[200px]">{cmd}</code>
                    </button>
                  ))}
                </div>
              )}

              {/* Replay button on SAM's messages (auto-speak handles first play) */}
              {msg.role === 'assistant' && msg.content && (
                <button
                  type="button"
                  onClick={() => speak(msg.id, msg.content)}
                  className="mt-1.5 text-void-400 hover:text-accent transition-colors"
                  title={speaking === msg.id ? 'Stop' : 'Replay'}
                >
                  {speaking === msg.id ? (
                    <VolumeX size={13} />
                  ) : (
                    <Volume2 size={13} />
                  )}
                </button>
              )}
            </div>
          </div>
        ))}

        {error && (
          <div className="text-center">
            <span className="text-xs text-red-400 bg-red-900/20 px-3 py-1.5 rounded-full">
              {error}
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        className="shrink-0 border-t border-void-700 bg-void-900/80 backdrop-blur-md
                   px-3 py-2.5 md:px-6 md:py-3 space-y-2
                   pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]"
      >
        {/* Voice record */}
        <div className="flex justify-center">
          <VoiceRecordButton
            onTranscribe={(text) => {
              setInput(text);
              // Auto-send after a beat so the user sees the transcript
              setTimeout(() => {
                // Use the text directly — setInput may be stale in the closure
                const sendText = text;
                if (!sendText.trim() || streaming) return;

                const userMsg: Message = {
                  id: `user_${Date.now()}`,
                  role: 'user',
                  content: sendText,
                };
                const assistantMsg: Message = {
                  id: `assistant_${Date.now()}`,
                  role: 'assistant',
                  content: '',
                };

                setMessages((prev) => [...prev, userMsg, assistantMsg]);
                setInput('');
                setStreaming(true);
                setError(null);

                const allMessages = [...messages, userMsg].map((m) => ({
                  role: m.role,
                  content: m.content,
                }));

                fetch('/api/chat', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ messages: allMessages }),
                })
                  .then(async (response) => {
                    if (!response.ok) {
                      const err = await response.json().catch(() => ({ error: 'Request failed' }));
                      throw new Error(err.error ?? `HTTP ${response.status}`);
                    }
                    if (!response.body) throw new Error('No response body');

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';

                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;

                      buffer += decoder.decode(value, { stream: true });
                      const lines = buffer.split('\n');
                      buffer = lines.pop() ?? '';

                      for (const line of lines) {
                        if (line.startsWith('data: ')) {
                          try {
                            const parsed = JSON.parse(line.slice(6));
                            if (parsed.text) {
                              setMessages((prev) => {
                                const updated = [...prev];
                                const last = updated[updated.length - 1];
                                if (last?.role === 'assistant') last.content += parsed.text;
                                return [...updated];
                              });
                            }
                          } catch { /* skip */ }
                        }
                      }
                    }
                  })
                  .catch((err) => {
                    setError(err instanceof Error ? err.message : 'Chat failed');
                    setMessages((prev) => {
                      const updated = [...prev];
                      if (updated[updated.length - 1]?.role === 'assistant' && !updated[updated.length - 1].content) {
                        updated.pop();
                      }
                      return updated;
                    });
                  })
                  .finally(() => setStreaming(false));
              }, 200);
            }}
          />
        </div>

        <form
          onSubmit={onSubmit}
          className="flex items-center gap-2 max-w-3xl mx-auto"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={streaming ? 'SAM is typing...' : 'Type a message...'}
            disabled={streaming}
            className="flex-1 bg-void-800 border border-void-600 rounded-full px-4 py-2.5
                       text-void-100 text-sm placeholder:text-void-600
                       focus:border-accent focus:outline-none
                       disabled:opacity-50"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={!input.trim() || streaming}
            className="p-2.5 bg-accent/20 border border-accent/40 rounded-full
                       text-accent hover:bg-accent/30 disabled:opacity-30
                       transition-colors shrink-0"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
