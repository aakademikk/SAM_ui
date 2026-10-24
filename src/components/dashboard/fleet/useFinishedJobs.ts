'use client';

/**
 * SAM: client poller for the finished-jobs lists (completed-jobs T7).
 *
 * Polls `/api/fleet/finished-jobs` (the fleet list, or one General's last
 * five) every `FINISHED_POLL_MS`, the same period as the General panel's old
 * poll. Paused while the tab is hidden, and fetches at once when it becomes
 * visible again. A failed round keeps the rows already shown; the next round
 * tries again. Same envelope handling as `GeneralDetailPanel`'s jobs fetch.
 */

import { useEffect, useState } from 'react';

import type { FinishedJob } from '@/types/finishedJobs';
import type { GeneralId } from '@/types/floor';
import { FINISHED_POLL_MS, finishedJobsUrl } from './finishedJobsView';

interface FinishedJobsEnvelope {
  data?: { jobs: FinishedJob[] };
}

export interface UseFinishedJobsOptions {
  /** One of the five Generals for its last five; absent for the fleet list. */
  general?: GeneralId;
  /** Demo mode: appends `demo=1`, so the live job store is never read. */
  demo?: boolean;
}

export function useFinishedJobs({ general, demo = false }: UseFinishedJobsOptions): { jobs: FinishedJob[] | null } {
  const url = finishedJobsUrl(general, demo);
  const [loaded, setLoaded] = useState<{ url: string; jobs: FinishedJob[] } | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ctl: AbortController | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const load = async () => {
      clearTimer();
      ctl?.abort();
      const mine = new AbortController();
      ctl = mine;
      try {
        const res = await fetch(url, { cache: 'no-store', signal: mine.signal });
        if (res.ok) {
          const json = (await res.json()) as FinishedJobsEnvelope;
          if (!stopped && ctl === mine && json.data && Array.isArray(json.data.jobs)) {
            setLoaded({ url, jobs: json.data.jobs });
          }
        }
      } catch {
        // keep what we had; the next round tries again
      }
      // a newer round (the tab became visible mid-request) owns the timer now
      if (stopped || ctl !== mine) return;
      ctl = null;
      if (document.visibilityState !== 'hidden') timer = setTimeout(load, FINISHED_POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') clearTimer();
      else void load();
    };

    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState !== 'hidden') void load();

    return () => {
      stopped = true;
      clearTimer();
      ctl?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [url]);

  // rows for a different General (or demo setting) are never shown under this one
  return { jobs: loaded && loaded.url === url ? loaded.jobs : null };
}
