/**
 * Login/step-up button — appears in the Sidebar.
 *
 * States:
 *   - Not authenticated: "Login" button → WebAuthn ceremony
 *   - Authenticated, step-up active: green indicator
 *   - Authenticated, step-up expired: "Unlock" button → biometric re-auth
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { LogIn, ShieldCheck, ShieldOff } from 'lucide-react';
import { authService } from '@/lib/authService';

interface AuthState {
  authenticated: boolean;
  device: string | null;
  stepUp: boolean;
}

export function LoginButton() {
  const [auth, setAuth] = useState<AuthState>({ authenticated: false, device: null, stepUp: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const state = await authService.checkSession();
      setAuth(state);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await authService.authenticate();
      await refresh();
    } catch (err) {
      if (err instanceof Error && err.name !== 'NotAllowedError') {
        setError(err.message.slice(0, 80));
      }
    } finally {
      setLoading(false);
    }
  };

  const onStepUp = async () => {
    setLoading(true);
    setError(null);
    try {
      await authService.stepUp();
      await refresh();
    } catch (err) {
      if (err instanceof Error && err.name !== 'NotAllowedError') {
        setError(err.message.slice(0, 80));
      }
    } finally {
      setLoading(false);
    }
  };

  if (!auth.authenticated) {
    return (
      <button
        type="button"
        onClick={onLogin}
        disabled={loading}
        className="flex items-center gap-2 px-3 py-2 text-sm text-void-300 hover:text-accent
                   hover:bg-void-800 rounded-md transition-colors w-full"
      >
        <LogIn size={15} />
        {loading ? 'Authenticating...' : 'Login'}
        {error && <span className="text-[10px] text-red-400 ml-1 truncate">{error}</span>}
      </button>
    );
  }

  if (!auth.stepUp) {
    return (
      <button
        type="button"
        onClick={onStepUp}
        disabled={loading}
        className="flex items-center gap-2 px-3 py-2 text-sm text-amber-400 hover:text-amber-300
                   hover:bg-amber-900/20 rounded-md transition-colors w-full"
      >
        <ShieldOff size={15} />
        {loading ? 'Unlocking...' : 'Unlock'}
        {error && <span className="text-[10px] text-red-400 ml-1 truncate">{error}</span>}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm text-emerald-400">
      <ShieldCheck size={15} />
      <span className="truncate text-xs">{auth.device ?? 'authenticated'}</span>
    </div>
  );
}
