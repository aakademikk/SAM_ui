/**
 * SAM — Chunked speech playback.
 *
 * Synthesising a whole answer before playing anything means waiting for the
 * slowest possible unit of work before hearing a single word. Splitting on
 * sentence boundaries lets playback start after the first short chunk while
 * the rest is synthesised in the background, so perceived latency becomes the
 * cost of one sentence rather than the entire reply.
 *
 * Chunks are always played in order, and exactly one request is in flight
 * ahead of playback — enough to hide synthesis time without queueing up work
 * that a `stop()` would waste.
 */

const MAX_CHUNK_CHARS = 220;
/** Below this, a trailing fragment is merged backwards rather than spoken alone. */
const MIN_TAIL_CHARS = 24;

/* ========================================================================== */
/* Autoplay unlocking                                                          */
/* ========================================================================== */

/**
 * Browsers refuse `audio.play()` without recent user activation, which is
 * exactly the situation when an answer finishes ten seconds after the user
 * last touched the screen — so auto-speak silently never played while the
 * manual speaker button (a genuine tap) always worked.
 *
 * The fix is to keep ONE audio element, unlocked during a real gesture by
 * playing a moment of silence. Playback permission is granted per element, so
 * every later chunk played through the same element is allowed.
 */
let sharedAudio: HTMLAudioElement | null = null;
let silentUrl: string | null = null;

/** A valid 44-byte-header WAV containing a single silent sample. */
function makeSilentWav(): string {
  if (silentUrl) return silentUrl;
  const samples = 1;
  const buf = new ArrayBuffer(44 + samples * 2);
  const dv = new DataView(buf);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) dv.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);      // PCM
  dv.setUint16(22, 1, true);      // mono
  dv.setUint32(24, 24000, true);  // sample rate
  dv.setUint32(28, 48000, true);  // byte rate
  dv.setUint16(32, 2, true);      // block align
  dv.setUint16(34, 16, true);     // bits per sample
  ascii(36, 'data');
  dv.setUint32(40, samples * 2, true);
  silentUrl = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silentUrl;
}

/**
 * Call from a real user gesture (send, mic, speaker tap). Cheap and safe to
 * call repeatedly — after the first success it is a no-op.
 */
export function primeSpeech(): void {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
  }
  if (sharedAudio.dataset?.unlocked === '1') return;

  sharedAudio.src = makeSilentWav();
  sharedAudio.muted = false;
  sharedAudio.volume = 1;
  void sharedAudio
    .play()
    .then(() => {
      if (sharedAudio) sharedAudio.dataset.unlocked = '1';
    })
    .catch(() => {
      // Still blocked — the manual speaker button remains the fallback.
    });
}

function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
  }
  return sharedAudio;
}

/**
 * Set when the browser refused playback outright. Surfaced in the UI so a
 * silent failure becomes a visible "tap to hear it" rather than a mystery.
 */
const blockedRef = { blocked: false };

export const isSpeechBlocked = () => blockedRef.blocked;
export const clearSpeechBlocked = () => {
  blockedRef.blocked = false;
};

/**
 * Split text into speakable chunks on sentence boundaries.
 *
 * Markdown fences, list bullets and inline code markers are stripped — they
 * are read aloud as noise otherwise.
 */
export function splitForSpeech(text: string): string[] {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' code block. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return [];

  // Split after ., !, ? or a newline, keeping the delimiter.
  const sentences = cleaned.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [cleaned];

  const chunks: string[] = [];
  let current = '';

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;

    if (!current) {
      current = sentence;
    } else if (current.length + sentence.length + 1 <= MAX_CHUNK_CHARS) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
    }

    // A very long single sentence still has to be broken somewhere.
    while (current.length > MAX_CHUNK_CHARS) {
      const cut = current.lastIndexOf(' ', MAX_CHUNK_CHARS);
      const at = cut > MAX_CHUNK_CHARS / 2 ? cut : MAX_CHUNK_CHARS;
      chunks.push(current.slice(0, at).trim());
      current = current.slice(at).trim();
    }
  }

  if (current) {
    if (chunks.length > 0 && current.length < MIN_TAIL_CHARS) {
      chunks[chunks.length - 1] += ` ${current}`;
    } else {
      chunks.push(current);
    }
  }

  return chunks;
}

export interface SpeechHandle {
  /** Resolves when playback finishes, is stopped, or fails. */
  done: Promise<void>;
  stop(): void;
}

/**
 * Every handle currently able to make noise.
 *
 * This is what the mute button calls. A single slot would not do the job: the
 * spoken ack is still finishing when the answer's speech starts and supersedes
 * it through the shared audio element, so two handles legitimately overlap — a
 * mute that silenced only the newest would leave the other one talking.
 *
 * Each stop() fires its own `onState(false)`, so the visualiser's ref-count
 * unwinds by itself and callers need not know how many were playing.
 */
const liveStops = new Set<() => void>();

/** Silence everything in flight, ack and answer alike. The global mute. */
export function stopAllSpeech(): void {
  for (const stop of [...liveStops]) stop();
  liveStops.clear();
}

/**
 * Speak `text`, starting playback as soon as the first chunk is ready.
 *
 * `onState` reports whether audio is currently audible, which drives the
 * visualiser without it needing to know anything about the audio pipeline.
 */
export function speakChunked(
  text: string,
  opts: {
    voice: number;
    /**
     * Override the Edge voice for this utterance. Absent → the stored SAM
     * preference. The practice agent needs the buyer's voice, which is not
     * SAM's and must not follow the operator's chat-voice setting.
     */
    edgeVoice?: string;
    /**
     * Override the Edge speaking rate for this utterance ("+0%", "-5%").
     * Absent → the voice service's configured default (SAM's +15%), which is
     * right for an assistant reading an answer back and wrong for a person sat
     * across a table.
     */
    edgeRate?: string;
    signal?: AbortSignal;
    onState?: (speaking: boolean) => void;
  },
): SpeechHandle {
  const chunks = splitForSpeech(text);
  const controller = new AbortController();
  const signal = controller.signal;

  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    liveStops.delete(stop);
    controller.abort();
    const audio = getAudio();
    audio.pause();
    audio.removeAttribute('src');
    opts.onState?.(false);
  };

  opts.signal?.addEventListener('abort', stop);
  // Registered so stopAllSpeech() can reach a handle nobody kept — which is
  // exactly the ack's situation: it is deliberately not held in speechRef.
  liveStops.add(stop);

  const synth = async (chunk: string): Promise<string | null> => {
    // Edge voice is read live so a preference change applies to the next turn
    // without a rebuild. Absent → voice-line falls back to its default (Abeo).
    // A caller-supplied voice wins: the practice buyer is not SAM.
    const edgeVoice = opts.edgeVoice ?? localStorage.getItem('sam-tts-edge-voice') ?? undefined;
    const response = await fetch('/api/chat/tts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        text: chunk,
        voice: opts.voice,
        edgeVoice,
        ...(opts.edgeRate ? { edgeRate: opts.edgeRate } : {}),
      }),
    });
    if (!response.ok) return null;
    return URL.createObjectURL(await response.blob());
  };

  // Always the same element, so the unlock earned during a user gesture
  // carries across every chunk and every later turn.
  const play = (url: string) =>
    new Promise<void>((resolve) => {
      if (stopped) return resolve();
      const audio = getAudio();
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onended = finish;
      audio.onerror = finish;
      audio.src = url;
      audio.play().catch((err) => {
        // NotAllowedError means autoplay was blocked despite priming.
        if ((err as Error)?.name === 'NotAllowedError') blockedRef.blocked = true;
        finish();
      });
    });

  const done = (async () => {
    if (chunks.length === 0) {
      // Nothing to say. Drop the registration by hand — the finally below is
      // not reached from here, and a stale stop would pause the shared audio
      // element the next time it was called, cutting off unrelated speech.
      liveStops.delete(stop);
      return;
    }

    try {
      opts.onState?.(true);

      // Kick off the first synthesis, then keep exactly one chunk in flight
      // ahead of whatever is playing.
      let pending: Promise<string | null> | null = synth(chunks[0]);

      for (let i = 0; i < chunks.length && !stopped; i++) {
        const url = await pending;
        pending = i + 1 < chunks.length ? synth(chunks[i + 1]) : null;
        if (!url || stopped) continue;
        await play(url);
      }

      // Don't leak a prefetched chunk that stop() raced past.
      void pending?.then((url) => url && URL.revokeObjectURL(url)).catch(() => {});
    } catch {
      // Aborted or network failure — treated as "stopped speaking".
    } finally {
      liveStops.delete(stop);
      opts.onState?.(false);
      opts.signal?.removeEventListener('abort', stop);
    }
  })();

  return { done, stop };
}
