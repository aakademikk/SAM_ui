/**
 * Inline Unlock — shown wherever a step-up error appears, so Colin can unlock
 * from the error itself (desktop or phone, sidebar visible or not).
 *
 * Runs the same biometric step-up as the sidebar LoginButton, shows progress
 * and any error, then calls `onRetry` once. If `onRetry` is omitted (or
 * returns false) the button unlocks only and says "Unlocked, try again".
 */

'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { authService } from '@/lib/authService';
import {
  UNLOCKED_MESSAGE,
  runUnlock,
  type CallFailure,
} from '@/lib/unlockFlow';

interface UnlockPromptProps {
  message: string;
  /** Re-run the action that failed. Return false if there was nothing to run. */
  onRetry?: () => Promise<boolean | void> | boolean | void;
  /** Called after a successful unlock, before the retry. */
  onUnlocked?: () => void;
  /** Test seam; defaults to the sidebar's own step-up. */
  stepUp?: () => Promise<void>;
  className?: string;
}

export function UnlockPrompt({ message, onRetry, onUnlocked, stepUp, className }: UnlockPromptProps) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  const unlock = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    const result = await runUnlock({
      stepUp: stepUp ?? (() => authService.stepUp()),
      retry: onRetry
        ? async () => {
            onUnlocked?.();
            return onRetry();
          }
        : undefined,
    });
    if (!onRetry && result.status === 'unlocked') onUnlocked?.();
    setBusy(false);
    if (result.status === 'unlocked') setNote({ text: UNLOCKED_MESSAGE, error: false });
    else if (result.status === 'failed' || result.status === 'retry-failed') {
      setNote({ text: result.message, error: true });
    }
  };

  return (
    <div className={className ?? 'flex flex-col items-center gap-2'} data-role="unlock-prompt">
      <span className="text-xs text-red-400 bg-red-900/20 px-3 py-1.5 rounded-full break-words text-center">
        {message}
      </span>
      <button
        type="button"
        onClick={() => void unlock()}
        disabled={busy}
        className="flex items-center gap-1.5 px-4 py-2 min-h-[40px] bg-accent/20 border border-accent/40
                   rounded-lg text-accent text-xs font-medium hover:bg-accent/30 transition-colors
                   disabled:opacity-50"
      >
        <Lock size={12} /> {busy ? 'Unlocking...' : 'Unlock'}
      </button>
      {note && (
        <span role="status" className={`text-[11px] ${note.error ? 'text-red-400' : 'text-emerald-400'}`}>
          {note.text}
        </span>
      )}
    </div>
  );
}

/** A failed call: the Unlock prompt for a step-up failure, plain text otherwise. */
export function CallError({
  failure,
  onRetry,
  onUnlocked,
}: {
  failure: CallFailure | null;
  onRetry: () => Promise<boolean | void> | boolean | void;
  onUnlocked?: () => void;
}) {
  if (!failure) return null;
  if (failure.stepUp) {
    return <UnlockPrompt message={failure.message} onRetry={onRetry} onUnlocked={onUnlocked} />;
  }
  return <p className="mt-3 text-xs text-red-400">{failure.message}</p>;
}
