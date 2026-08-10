/**
 * SAM — Credential store.
 *
 * Persists WebAuthn credentials to disk so they survive server restarts.
 * Cached on globalThis (same pattern as telemetry + job manager).
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const AUTH_DIR = path.join(os.homedir(), '.sam', 'auth');
const CREDENTIALS_PATH = path.join(AUTH_DIR, 'credentials.json');

export interface StoredCredential {
  credentialId: string;       // base64url
  publicKey: Uint8Array;      // raw bytes, serialized as base64url in JSON
  counter: number;
  transports: string[];
  deviceName: string;
  createdAt: string;          // ISO-8601
}

interface CredentialJSON {
  credentialId: string;
  publicKey: string;          // base64url-encoded
  counter: number;
  transports: string[];
  deviceName: string;
  createdAt: string;
}

/* ========================================================================== */
/* Challenge store (ephemeral, in-memory only)                                 */
/* ========================================================================== */

const challenges = new Map<string, { value: string; expiresAt: number }>();

function pruneChallenges() {
  const now = Date.now();
  for (const [key, entry] of challenges) {
    if (entry.expiresAt < now) challenges.delete(key);
  }
}

export function setChallenge(userId: string, value: string, ttlMs = 300_000) {
  pruneChallenges();
  challenges.set(userId, { value, expiresAt: Date.now() + ttlMs });
}

export function getChallenge(userId: string): string | null {
  pruneChallenges();
  const entry = challenges.get(userId);
  if (!entry) return null;
  challenges.delete(userId); // single-use
  return entry.value;
}

/* ========================================================================== */
/* Credential persistence                                                      */
/* ========================================================================== */

async function ensureDir() {
  await fsp.mkdir(AUTH_DIR, { recursive: true });
}

async function readCredentials(): Promise<StoredCredential[]> {
  try {
    const raw = await fsp.readFile(CREDENTIALS_PATH, 'utf-8');
    const list: CredentialJSON[] = JSON.parse(raw);
    return list.map((c) => ({
      ...c,
      publicKey: new Uint8Array(Buffer.from(c.publicKey, 'base64url')),
    }));
  } catch {
    return [];
  }
}

async function writeCredentials(creds: StoredCredential[]) {
  await ensureDir();
  const list: CredentialJSON[] = creds.map((c) => ({
    credentialId: c.credentialId,
    publicKey: Buffer.from(c.publicKey).toString('base64url'),
    counter: c.counter,
    transports: c.transports,
    deviceName: c.deviceName,
    createdAt: c.createdAt,
  }));
  await fsp.writeFile(CREDENTIALS_PATH, JSON.stringify(list, null, 2));
}

/* ========================================================================== */
/* Singleton CRUD                                                              */
/* ========================================================================== */

class CredentialStore {
  private credentials: StoredCredential[] = [];
  private loaded = false;

  async ensureLoaded() {
    if (!this.loaded) {
      this.credentials = await readCredentials();
      this.loaded = true;
    }
  }

  async add(cred: StoredCredential) {
    await this.ensureLoaded();
    // Replace if same credentialId exists (re-registration).
    const idx = this.credentials.findIndex((c) => c.credentialId === cred.credentialId);
    if (idx >= 0) this.credentials[idx] = cred;
    else this.credentials.push(cred);
    await writeCredentials(this.credentials);
  }

  async findByCredentialId(credentialId: string): Promise<StoredCredential | null> {
    await this.ensureLoaded();
    return this.credentials.find((c) => c.credentialId === credentialId) ?? null;
  }

  async list(): Promise<Omit<StoredCredential, 'publicKey' | 'counter'>[]> {
    await this.ensureLoaded();
    return this.credentials.map((cred) => ({
      credentialId: cred.credentialId,
      deviceName: cred.deviceName,
      transports: cred.transports,
      createdAt: cred.createdAt,
    }));
  }

  async remove(credentialId: string): Promise<boolean> {
    await this.ensureLoaded();
    const idx = this.credentials.findIndex((c) => c.credentialId === credentialId);
    if (idx < 0) return false;
    this.credentials.splice(idx, 1);
    await writeCredentials(this.credentials);
    return true;
  }

  async updateCounter(credentialId: string, newCounter: number) {
    await this.ensureLoaded();
    const cred = this.credentials.find((c) => c.credentialId === credentialId);
    if (cred) {
      cred.counter = newCounter;
      await writeCredentials(this.credentials);
    }
  }
}

const globalForSam = globalThis as unknown as { __samCredentialStore?: CredentialStore };

export function getCredentialStore(): CredentialStore {
  if (!globalForSam.__samCredentialStore) {
    globalForSam.__samCredentialStore = new CredentialStore();
  }
  return globalForSam.__samCredentialStore;
}
