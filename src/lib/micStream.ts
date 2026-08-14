/**
 * Shared mic acquisition for the voice components.
 *
 * The hold-to-record button and the hands-free loop need the same thing: a
 * getUserMedia stream plus an analyser for the level meter / voice-activity
 * detection. Acquisition is the part that needs a user gesture or a
 * pre-granted permission, and the part whose failures need careful messaging,
 * so it lives here once instead of twice.
 */

export interface MicStream {
  stream: MediaStream;
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  /** Stops the tracks and closes the context. Safe to call more than once. */
  close(): void;
}

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
};

export function micErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') {
      return 'Microphone permission denied. Check site settings in Chrome.';
    }
    if (err.name === 'NotFoundError') {
      return 'No microphone found on this device.';
    }
  }
  return 'Failed to access microphone. Check permissions.';
}

/**
 * Acquire the mic and attach an analyser. Throws on failure — map the error
 * with `micErrorMessage`. The analyser uses time-domain data at 1024 samples,
 * which the VAD in HandsFreeMic reads directly.
 */
export async function acquireMicStream(): Promise<MicStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.3;
  source.connect(analyser);

  let closed = false;
  return {
    stream,
    ctx,
    source,
    analyser,
    close() {
      if (closed) return;
      closed = true;
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

/** Pick the MediaRecorder mime type the browser actually supports. */
export function pickRecordingMime(): string {
  return MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
}
