/**
 * SAM — real host + docker telemetry.
 *
 * Everything here reads the actual machine: /proc, os(), and `docker inspect`
 * on the fixed container names from the Parkfords/Atwood n8n stack. No shell
 * interpolation of external input — the only exec target is a hardcoded
 * container name, never anything from a request.
 */

import os from 'node:os';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { clamp } from '@/lib/utils';
import type { ServiceNode, ServiceState } from '@/types/dashboard';

let lastCpuTimes: { idle: number; total: number } | null = null;
let lastNet: { bytes: number; at: number } | null = null;

function readCpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const t of Object.values(cpu.times)) total += t;
    idle += cpu.times.idle;
  }
  return { idle, total };
}

/** Real CPU usage %, derived from the idle/total delta since the last sample. */
export function sampleCpuPct(): number {
  const now = readCpuTimes();
  if (!lastCpuTimes) {
    lastCpuTimes = now;
    return clamp((os.loadavg()[0] / os.cpus().length) * 100, 0, 100);
  }
  const idleDelta = now.idle - lastCpuTimes.idle;
  const totalDelta = now.total - lastCpuTimes.total;
  lastCpuTimes = now;
  if (totalDelta <= 0) return 0;
  return clamp(100 - (idleDelta / totalDelta) * 100, 0, 100);
}

export function sampleMemPct(): number {
  const total = os.totalmem();
  const free = os.freemem();
  return clamp(((total - free) / total) * 100, 0, 100);
}

export function sampleDiskPct(path: string): number {
  try {
    const stats = fs.statfsSync(path);
    const used = stats.blocks - stats.bfree;
    return clamp((used / stats.blocks) * 100, 0, 100);
  } catch {
    return 0;
  }
}

/** Real throughput in Mbps, summed across non-loopback interfaces via /proc/net/dev. */
export function sampleNetMbps(): number {
  try {
    const raw = fs.readFileSync('/proc/net/dev', 'utf8');
    let bytes = 0;
    for (const line of raw.split('\n').slice(2)) {
      const [iface, rest] = line.split(':');
      if (!iface || !rest) continue;
      if (iface.trim() === 'lo') continue;
      const fields = rest.trim().split(/\s+/).map(Number);
      bytes += (fields[0] ?? 0) + (fields[8] ?? 0); // rx bytes + tx bytes
    }
    const now = Date.now();
    if (!lastNet) {
      lastNet = { bytes, at: now };
      return 0;
    }
    const dtSec = (now - lastNet.at) / 1000;
    const deltaBytes = bytes - lastNet.bytes;
    lastNet = { bytes, at: now };
    if (dtSec <= 0) return 0;
    return Math.max(0, (deltaBytes * 8) / dtSec / 1_000_000);
  } catch {
    return 0;
  }
}

export interface HostSample {
  cpuPct: number;
  memPct: number;
  diskPct: number;
  netMbps: number;
  loadAvg: [number, number, number];
  uptimeSec: number;
}

export function sampleHost(diskPath: string): HostSample {
  return {
    cpuPct: sampleCpuPct(),
    memPct: sampleMemPct(),
    diskPct: sampleDiskPct(diskPath),
    netMbps: sampleNetMbps(),
    loadAvg: os.loadavg() as [number, number, number],
    uptimeSec: os.uptime(),
  };
}

export interface ServiceBlueprint {
  id: string;
  name: string;
  kind: string;
  containerName: string;
}

/** The real containers on this box (see /home/col/n8n-docker/docker-compose.yml). */
export const REAL_SERVICE_BLUEPRINTS: ServiceBlueprint[] = [
  { id: 'svc_n8n', name: 'n8n-orchestrator', kind: 'n8n', containerName: 'n8n-docker-n8n-1' },
  { id: 'svc_docmerge', name: 'docmerge', kind: 'worker', containerName: 'n8n-docker-docmerge-1' },
  { id: 'svc_cloudflared', name: 'cloudflared-tunnel', kind: 'proxy', containerName: 'n8n-docker-cloudflared-1' },
];

export function sampleDockerService(bp: ServiceBlueprint): ServiceNode {
  try {
    const status = execFileSync('docker', ['inspect', '--format', '{{.State.Status}}', bp.containerName], {
      encoding: 'utf8',
      timeout: 2000,
    }).trim();
    const state: ServiceState = status === 'running' ? 'operational' : status === 'restarting' ? 'degraded' : 'down';
    return {
      id: bp.id,
      name: bp.name,
      kind: bp.kind,
      state,
      latencyMs: 0,
      uptimePct: state === 'operational' ? 100 : 0,
      incidents24h: state === 'operational' ? 0 : 1,
    };
  } catch {
    return {
      id: bp.id,
      name: bp.name,
      kind: bp.kind,
      state: 'down',
      latencyMs: 0,
      uptimePct: 0,
      incidents24h: 1,
    };
  }
}
