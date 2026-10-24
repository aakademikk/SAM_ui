'use client';

/**
 * SAM: the finished-jobs list (completed-jobs T7).
 *
 * One row component for the fleet list under Fleet status, each General's
 * "Last 5 finished" and the phone sheet, so the three cannot disagree. Each
 * row is a real link to the job's output page, `/jobs/<id>` (must-do 6), and
 * shows the name, the General ("SAM" for SAM's own jobs), the UTC finish time
 * and the outcome pill: the closer's verdict word for word when there is one,
 * the job's own outcome otherwise (must-dos 4, 14, 15). No model, no cost.
 * The words come from `finishedJobsView.ts`.
 *
 * UX floors: every row at least 44 px tall, no text under 12 px, and body text
 * in `text` or `muted` only (both above 4.5:1 on the dark panel; `faint` is
 * not, so it is not used for text here). Colours are `GeneralDetailPanel`'s
 * `C` palette, restated: no new theme tokens.
 */

import type { FinishedJob } from '@/types/finishedJobs';
import { primaryTone, rowAriaLabel, rowLabels } from './finishedJobsView';

const C = {
  text: '#e8f7ee',
  muted: '#98b6a6',
  ok: '#9dff70',
  okBg: 'rgba(157,255,112,.09)',
  bad: '#ff7a70',
  badBg: 'rgba(255,122,112,.1)',
  chip: 'rgba(157,255,112,.06)',
  line: 'rgba(157,255,112,.075)',
};

const TONES = {
  ok: { color: C.ok, background: C.okBg },
  bad: { color: C.bad, background: C.badBg },
  neutral: { color: C.text, background: C.chip },
} as const;

export interface FinishedJobsListProps {
  /** Rows, newest first; null while the first poll has not answered (nothing is listed then). */
  jobs: FinishedJob[] | null;
  title: string;
  /** Show each row's General. */
  showGeneral: boolean;
  /** Shown once loaded, when there are no rows. */
  emptyText: string;
  /** Drop the panel's own background and border, for use inside another panel. */
  bare?: boolean;
  className?: string;
}

export default function FinishedJobsList({ jobs, title, showGeneral, emptyText, bare = false, className }: FinishedJobsListProps) {
  const now = Date.now();
  return (
    <section
      aria-label={title}
      aria-busy={jobs === null}
      data-finished-jobs
      className={`flex min-h-0 flex-col ${bare ? '' : 'rounded-xl border'} ${className ?? ''}`}
      style={
        bare
          ? undefined
          : { background: 'linear-gradient(180deg, rgba(9,28,20,.82), rgba(5,17,12,.86))', borderColor: 'rgba(61,255,90,.12)' }
      }
    >
      <header className={bare ? 'pb-2' : 'px-3.5 pt-3 pb-2'}>
        <span className="text-[12px] font-semibold tracking-[0.1em] uppercase" style={{ color: C.muted }}>
          {title}
        </span>
      </header>
      {jobs === null ? null : jobs.length === 0 ? (
        <p className={`m-0 text-[12px] ${bare ? '' : 'px-3.5 pb-3'}`} style={{ color: C.muted }}>
          {emptyText}
        </p>
      ) : (
        <ul className={`m-0 list-none p-0 ${bare ? '' : 'px-1.5 pb-2'}`}>
          {jobs.map((job, i) => {
            const l = rowLabels(job, now);
            return (
              <li key={job.id} style={{ borderTop: i ? `1px solid ${C.line}` : undefined }}>
                <a
                  href={'/jobs/' + encodeURIComponent(job.id)}
                  aria-label={rowAriaLabel(l, showGeneral)}
                  data-finished-row
                  className="flex min-h-[44px] flex-col justify-center gap-0.5 rounded-md px-2 py-1.5 text-[12px] no-underline transition-colors hover:bg-[rgba(157,255,112,.06)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[rgba(61,255,90,.34)]"
                  style={{ color: C.text }}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={l.name}>
                      {l.name}
                    </span>
                    <time dateTime={job.endedAt} className="shrink-0 tabular-nums" style={{ color: C.muted }}>
                      {l.when}
                    </time>
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    {showGeneral ? (
                      <span className="shrink-0" style={{ color: C.muted }}>
                        {l.generalLabel}
                      </span>
                    ) : null}
                    <span
                      className="inline-flex min-w-0 items-center gap-[5px] rounded-full px-2 py-px text-[12.5px] font-semibold"
                      style={TONES[primaryTone(job)]}
                      title={l.primary}
                      data-outcome
                    >
                      <i aria-hidden className="inline-block size-[5px] shrink-0 rounded-full" style={{ background: 'currentColor' }} />
                      <span className="truncate">{l.primary}</span>
                    </span>
                    {l.secondary ? (
                      <small className="shrink-0 text-[12px]" style={{ color: C.muted }} title={`The job's own outcome: ${l.secondary}`} data-own-outcome>
                        Job: {l.secondary}
                      </small>
                    ) : null}
                    {l.notChecked ? (
                      <small className="shrink-0 text-[12px]" style={{ color: C.muted }} title="No closer verdict for this job" data-not-checked>
                        not checked
                      </small>
                    ) : null}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
