/**
 * /register — WebAuthn passkey registration.
 *
 * Run once from the desktop to create the first passkey. Additional
 * devices can be registered from Settings (authenticated session required).
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authService } from '@/lib/authService';

export default function RegisterPage() {
  const router = useRouter();
  const [deviceName, setDeviceName] = useState('Desktop');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceName.trim()) return;

    setLoading(true);
    setError(null);

    try {
      await authService.register(deviceName.trim());
      setSuccess(true);
      setTimeout(() => router.push('/'), 1500);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message.slice(0, 120));
      } else {
        setError('Registration failed. Make sure your device supports passkeys (fingerprint or face).');
      }
    } finally {
      setLoading(false);
    }
  };

  // Check we're on the correct origin (RP ID must match).
  const expectedHost = 'super-awesome-machine.tail2eadff.ts.net';
  const isCorrectOrigin =
    typeof window !== 'undefined' && window.location.hostname === expectedHost;

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-accent">Register Passkey</h1>
          <p className="text-sm text-dim-300">
            Create a passkey to secure SAM. This uses your device&apos;s built-in
            authenticator — fingerprint on Android, Touch ID on Mac, or Windows Hello.
            On Linux desktops, you can use a USB security key or scan a QR code with your phone.
          </p>
        </div>

        {!isCorrectOrigin && (
          <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-3">
            <p className="text-amber-400 text-sm font-medium">
              Wrong origin — passkeys will not work here.
            </p>
            <p className="text-amber-300/70 text-xs mt-1">
              Open{' '}
              <code className="bg-void-800 px-1 py-0.5 rounded text-amber-200">
                https://{expectedHost}/register
              </code>{' '}
              instead. WebAuthn requires the domain to match the RP ID exactly.
            </p>
          </div>
        )}

        {success ? (
          <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-lg p-4 text-center">
            <p className="text-emerald-400 font-medium">Passkey registered!</p>
            <p className="text-dim-300 text-sm mt-1">Redirecting to dashboard...</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="deviceName" className="block text-sm text-dim-200 mb-1">
                Device name
              </label>
              <input
                id="deviceName"
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                className="w-full bg-void-900 border border-void-600 rounded px-3 py-2
                           text-void-100 text-sm focus:border-accent focus:outline-none"
                placeholder="e.g. Col's A16, Desktop, Laptop"
                required
                maxLength={64}
              />
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-3">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-accent/20 border border-accent/40 rounded-lg
                         text-accent font-medium hover:bg-accent/30
                         disabled:opacity-40 transition-colors"
            >
              {loading ? 'Creating passkey...' : 'Register Passkey'}
            </button>

            <p className="text-[11px] text-dim-500 text-center">
              Your browser will prompt for biometric verification (fingerprint / face / PIN).
              The passkey is stored on your device — nothing leaves this machine.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
