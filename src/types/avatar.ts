// ---------------------------------------------------------------------------
// Avatar system: Simli WebRTC + ElevenLabs TTS
// ---------------------------------------------------------------------------

/** High-level lifecycle so the UI never guesses. */
export type AvatarConnectionState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'speaking'
  | 'error';

/** Returned by POST /api/avatar/session when the server exchanges the
 *  server-side Simli API key for a time-limited client credential. */
export interface AvatarSession {
  /** Opaque session token the SimliClient constructor expects. */
  sessionToken: string;
  /** Face ID assigned to this session (echoed from server config). */
  faceId: string;
  /** ICE servers for WebRTC peer connection (STUN/TURN). */
  iceServers: RTCIceServer[];
  /** ISO-8601 expiry so the client can pre-emptively refresh. */
  expiresAt: string;
}

/** Payload sent by the client to the TTS proxy. */
export interface TTSRequest {
  text: string;
  /** Optional override — defaults to the server-configured voice. */
  voiceId?: string;
}

/** Possible error codes the API routes return so the UI can branch. */
export type AvatarErrorCode =
  | 'CONFIG_MISSING'
  | 'SIMLI_AUTH_FAILED'
  | 'SIMLI_SESSION_FAILED'
  | 'TTS_FAILED'
  | 'TTS_STREAM_ABORTED'
  | 'RTC_DISCONNECTED';

export interface AvatarErrorPayload {
  code: AvatarErrorCode;
  message: string;
}
