/**
 * SAM — Command audit log.
 *
 * Logs every command execution with: job ID, command string, originating
 * device, and timestamp. Appends JSON lines to ~/.sam/audit.log.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const AUDIT_PATH = path.join(os.homedir(), '.sam', 'audit.log');

export interface AuditEntry {
  jobId: string;
  command: string;
  device: string;      // credential deviceName from session
  credentialId: string; // first 12 chars of the WebAuthn credential ID
  timestamp: string;    // ISO-8601
}

export async function logCommand(entry: AuditEntry) {
  const line = JSON.stringify(entry) + '\n';
  try {
    await fsp.appendFile(AUDIT_PATH, line);
  } catch {
    // Audit failure is non-fatal.
  }
}

export async function readAuditLog(limit = 100): Promise<AuditEntry[]> {
  try {
    const raw = await fsp.readFile(AUDIT_PATH, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try {
        return JSON.parse(line) as AuditEntry;
      } catch {
        return null;
      }
    }).filter(Boolean) as AuditEntry[];
  } catch {
    return [];
  }
}
