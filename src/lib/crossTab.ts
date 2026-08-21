/**
 * Cross-tab message bus via localStorage.
 *
 * Chat ↔ Terminal interop: tap a command in chat to run it in terminal,
 * send terminal job output to chat for discussion with SAM.
 */

const PREFIX = 'sam-xmsg-';

export interface CrossTabMessage {
  type: 'command' | 'chat';
  text: string;
  timestamp: number;
}

/** Write a message for another tab to pick up. */
export function sendMessage(msg: CrossTabMessage) {
  localStorage.setItem(`${PREFIX}${msg.type}`, JSON.stringify(msg));
  // Trigger storage event so the other tab picks it up immediately.
  window.dispatchEvent(new StorageEvent('storage', {
    key: `${PREFIX}${msg.type}`,
    newValue: JSON.stringify(msg),
  }));
}

/** Read and clear a message. Returns null if none pending. */
export function readMessage(type: 'command' | 'chat'): string | null {
  const key = `${PREFIX}${type}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const msg = JSON.parse(raw) as CrossTabMessage;
    if (msg.type === type) {
      localStorage.removeItem(key);
      return msg.text;
    }
  } catch { /* corrupted */ }
  localStorage.removeItem(key);
  return null;
}
