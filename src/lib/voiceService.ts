/**
 * SAM — Voice API client.
 */

export async function transcribeAudio(audioBlob: Blob): Promise<{ transcript: string; latencyMs: number }> {
  const response = await fetch('/api/voice/transcribe', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': audioBlob.type || 'audio/webm' },
    body: audioBlob,
  });

  const json: unknown = await response.json();
  const record = json as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(typeof record.error === 'string' ? record.error : 'Transcription failed');
  }

  return {
    transcript: (record.data as Record<string, string>)?.transcript ?? '',
    latencyMs: (record.data as Record<string, number>)?.latencyMs ?? 0,
  };
}
