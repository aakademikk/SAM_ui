/**
 * Voice roster data — shared between client (Settings page) and server (TTS).
 *
 * Kokoro multi-lang v1.0: 53 voices across 13 languages.
 * SID mapping: https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html
 */

export const VOICES: Record<number, string> = {
  0: 'af_alloy', 1: 'af_aoede', 2: 'af_bella', 3: 'af_heart',
  4: 'af_jessica', 5: 'af_kore', 6: 'af_nicole', 7: 'af_nova',
  8: 'af_river', 9: 'af_sarah', 10: 'af_sky',
  11: 'am_adam', 12: 'am_echo', 13: 'am_eric', 14: 'am_fenrir',
  15: 'am_liam', 16: 'am_michael', 17: 'am_onyx', 18: 'am_puck', 19: 'am_santa',
  20: 'bf_alice', 21: 'bf_emma', 22: 'bf_isabella', 23: 'bf_lily',
  24: 'bm_daniel', 25: 'bm_fable', 26: 'bm_george', 27: 'bm_lewis',
  28: 'ef_dora', 29: 'em_alex',
  30: 'ff_siwis',
  31: 'hf_alpha', 32: 'hf_beta', 33: 'hm_omega', 34: 'hm_psi',
  35: 'if_sara', 36: 'im_nicola',
  37: 'jf_alpha', 38: 'jf_gongitsune', 39: 'jf_nezumi', 40: 'jf_tebukuro', 41: 'jm_kumo',
  42: 'pf_dora', 43: 'pm_alex', 44: 'pm_santa',
  45: 'zf_xiaobei', 46: 'zf_xiaoni', 47: 'zf_xiaoxiao', 48: 'zf_xiaoyi',
  49: 'zm_yunjian', 50: 'zm_yunxi', 51: 'zm_yunxia', 52: 'zm_yunyang',
};

export const VOICE_GROUPS: { label: string; voices: { id: number; name: string }[] }[] = [
  {
    label: 'British Female',
    voices: [20, 21, 22, 23].map((id) => ({ id, name: VOICES[id] })),
  },
  {
    label: 'British Male',
    voices: [24, 25, 26, 27].map((id) => ({ id, name: VOICES[id] })),
  },
  {
    label: 'American Female',
    voices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => ({ id, name: VOICES[id] })),
  },
  {
    label: 'American Male',
    voices: [11, 12, 13, 14, 15, 16, 17, 18, 19].map((id) => ({ id, name: VOICES[id] })),
  },
];

export const DEFAULT_VOICE = 21; // bf_emma — British Female
