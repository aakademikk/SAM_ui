/**
 * SAM — Auth API client.
 *
 * Thin wrapper around the WebAuthn registration/authentication endpoints.
 * Uses @simplewebauthn/browser for client-side WebAuthn operations.
 */

import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

const BASE = '/api/auth';

interface SessionState {
  authenticated: boolean;
  device: string | null;
  stepUp: boolean;
}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const url = `${BASE}${path}`;
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json: unknown = await response.json();
  const record = json as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(
      typeof record.error === 'string' ? record.error : `${options.method ?? 'GET'} ${path} failed`,
    );
  }

  return record.data as T;
}

export const authService = {
  /** Check current session state. */
  async checkSession(): Promise<SessionState> {
    try {
      const data = await request<{
        authenticated: boolean;
        device: string;
        stepUp: boolean;
        sessionCreated: string;
        stepUpCreated: string | null;
      }>('/session');
      return {
        authenticated: data.authenticated,
        device: data.device,
        stepUp: data.stepUp,
      };
    } catch {
      return { authenticated: false, device: null, stepUp: false };
    }
  },

  /** Register a new passkey (step 1: options → create → step 2: verify). */
  async register(deviceName: string): Promise<void> {
    const options = await request<Record<string, unknown>>('/register/options', {
      method: 'POST',
      body: { deviceName },
    });

    const registrationResponse = await startRegistration({
      optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
    });

    await request('/register/verify', {
      method: 'POST',
      body: { deviceName, registrationResponse, userId: deviceName },
    });
  },

  /** Authenticate with an existing passkey. */
  async authenticate(): Promise<void> {
    const options = await request<Record<string, unknown>>('/authenticate/options', {
      method: 'POST',
    });

    const authResponse = await startAuthentication({
      optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
    });

    await request('/authenticate/verify', {
      method: 'POST',
      body: { assertionResponse: authResponse },
    });
  },

  /** Step-up: re-authenticate for write operations. */
  async stepUp(): Promise<void> {
    // First get options (requires valid session cookie)
    const options = await request<Record<string, unknown>>('/stepup', {
      method: 'GET',
    });

    const authResponse = await startAuthentication({
      optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
    });

    await request('/stepup', {
      method: 'POST',
      body: { assertionResponse: authResponse },
    });
  },

  /** List registered devices. */
  async listDevices(): Promise<{ credentialId: string; deviceName: string; createdAt: string }[]> {
    return request('/devices');
  },

  /** Revoke a registered device. */
  async revokeDevice(credentialId: string): Promise<void> {
    await request('/devices', {
      method: 'DELETE',
      body: { credentialId },
    });
  },
};
