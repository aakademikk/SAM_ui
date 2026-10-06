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
