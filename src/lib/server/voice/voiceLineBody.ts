/**
 * The JSON body sent to voice-line's /api/tts, built from the chat TTS request.
 *
 * Pure so it can be tested without loading the Kokoro fallback. `edgeVoice` is
 * passed through unvalidated (voice-line decides what it means): an Edge
 * ShortName, or "elevenlabs" for the paid SAM (ElevenLabs) voice, which
 * voice-line falls back from to Edge on any failure. `edgeRate` shape is
 * validated downstream in voice-line's mouth.normalise_rate.
 */
export function buildVoiceLineBody(
  text: string,
  edgeVoice: unknown,
  edgeRate: unknown,
): { text: string; voice?: string; rate?: string } {
  return {
    text,
    ...(typeof edgeVoice === 'string' && edgeVoice ? { voice: edgeVoice } : {}),
    ...(typeof edgeRate === 'string' && edgeRate ? { rate: edgeRate } : {}),
  };
}

/**
 * The abort signal for the upstream voice-line fetch: the deadline, or the
 * browser giving up on the request, whichever comes first. The browser aborts
 * its fetch when speech is stopped or a new turn starts; without following
 * `requestSignal` the chunk in flight (and the prefetched one) still ran to the
 * end at ElevenLabs and was billed for audio nobody heard.
 */
export function voiceLineSignal(requestSignal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([requestSignal, AbortSignal.timeout(timeoutMs)]);
}
