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
  // 0700: this directory also holds the JWT signing key. Default umask would
  // leave it group- and world-readable on a box that has other service users.
  await fsp.mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
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
  /*
   * Atomic write: temp file in the same directory, fsync, then rename.
   * (SAM_ui_Audit_2026-09-20 finding 9.)
   *
   * This was a bare writeFile, which truncates first and then writes. A crash,
   * an OOM kill or a full disk between those two steps leaves a truncated or
   * empty file — and readCredentials() swallows a parse failure and returns [],
   * so the failure presents as "every passkey silently forgotten". Recovery is
   * re-running sam-enrol on the desktop for every device, and until 2026-09-20
   * there was no backup of this file either.
   *
   * rename(2) within a filesystem is atomic: a reader sees either the whole old
   * file or the whole new one, never a partial. The fsync before it is what
   * makes that true across a power loss rather than just across a crash —
   * without it the rename can land before the data does.
   *
   * mode 0o600 on the temp file, because the rename preserves the temp file's
   * permissions, not the destination's.
   */
  const tmp = `${CREDENTIALS_PATH}.tmp`;
  const handle = await fsp.open(tmp, 'w', 0o600);
  try {
    await handle.writeFile(JSON.stringify(list, null, 2), 'utf-8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(tmp, CREDENTIALS_PATH);
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
