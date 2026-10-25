import { record, finite } from '../core/helper-values';
import { escapeHtml, truncate } from '../core/helper-format';
import { formatToolArguments } from './helper-format';

/** OMP bash result details: timing, exit status and the deadline of a backgrounded job. */
export interface BashToolDetails {
  readonly kind: 'bash'; readonly wallTimeMs?: number; readonly exitCode?: number; readonly timedOut: boolean;
  readonly timeoutSeconds?: number; readonly timeoutDisabled: boolean; readonly jobId?: string;
}
export interface WaitJob {
  readonly id: string; readonly type?: string; readonly status: string; readonly label?: string;
  readonly durationMs?: number; readonly exitCode?: number; readonly resultText?: string; readonly errorText?: string;
}
/** OMP wait result details: one row per watched background job. */
export interface WaitToolDetails { readonly kind: 'wait'; readonly jobs: readonly WaitJob[] }
export type ToolDetails = BashToolDetails | WaitToolDetails;

/**
 * OMP 18's `wait` returns a still-running snapshot after this safety cap even
 * when no watched job has settled (packages/coding-agent/src/tools/wait.ts).
 */
export const WAIT_SAFETY_CAP_MS = 30 * 60_000;
const OUTPUT_LIMIT = 8000;
const string = (value: unknown) => typeof value === 'string' && value ? value : undefined;
const number = (value: unknown) => finite(value) ? value : undefined;

export function decodeToolDetails(toolName: string | undefined, value: unknown): ToolDetails | undefined {
  if (!record(value)) return undefined;
  if (toolName === 'bash') {
    return { kind: 'bash', wallTimeMs: number(value.wallTimeMs), exitCode: number(value.exitCode), timedOut: value.timedOut === true,
      timeoutSeconds: number(value.timeoutSeconds), timeoutDisabled: value.timeoutDisabled === true,
      jobId: record(value.async) ? string(value.async.jobId) : undefined };
  }
  if (toolName === 'wait' && Array.isArray(value.jobs)) {
    return { kind: 'wait', jobs: value.jobs.flatMap((job: unknown): WaitJob[] => record(job) && string(job.id) ? [{
      id: String(job.id), type: string(job.type), status: string(job.status) || 'unknown', label: string(job.label),
      durationMs: number(job.durationMs), exitCode: number(job.exitCode), resultText: string(job.resultText), errorText: string(job.errorText),
    }] : []) };
  }
  return undefined;
}

/** Compact span for tool timing: 85ms, 4.2s, 42s, 3m 08s, 1h 02m. */
export function formatSpan(ms: number) {
  const value = Math.max(0, ms);
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 10_000) return `${(value / 1000).toFixed(1)}s`;
  const total = Math.floor(value / 1000);
  if (total < 60) return `${total}s`;
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

/**
 * Tool-call body. Bash shows the command as a shell block with its execution
 * options underneath; a bare OMP wait shows its intent; others keep the
 * argument dump.
 */
export function toolCallBodyHtml(name: string | undefined, args: Readonly<Record<string, unknown>>) {
  if ((name === 'bash' || name === 'Bash') && typeof args.command === 'string') {
    const meta: string[] = [];
    if (typeof args.cwd === 'string' && args.cwd) meta.push(`cwd <code>${escapeHtml(args.cwd)}</code>`);
    if (args.timeout === 0) meta.push('no timeout');
    else if (finite(args.timeout)) meta.push(`timeout ${args.timeout}s`);
    if (args.async === true) meta.push('background');
    if (args.pty === true) meta.push('pty');
    if (typeof args.name === 'string' && args.name) meta.push(`service <code>${escapeHtml(args.name)}</code>`);
    return `<pre class="tool-command"><code>${escapeHtml(args.command)}</code></pre>` +
      (meta.length ? `<div class="tool-command-meta">${meta.join('<span class="tool-meta-sep">·</span>')}</div>` : '');
  }
  if (name === 'wait' && Object.keys(args).every(key => key === 'i')) {
    return typeof args.i === 'string' && args.i ? `<div class="tool-call-intent">${escapeHtml(args.i)}</div>` : '';
  }
  return `<pre><code>${escapeHtml(formatToolArguments(name, args))}</code></pre>`;
}

/** Source block a live panel shows above its output (eval cells, bash commands). */
export function toolSourceText(name: string, args: unknown, intent?: string) {
  if (name === 'bash' || name === 'Bash') return record(args) && typeof args.command === 'string' ? args.command : '';
  if (name !== 'eval' && name !== 'ipython') return '';
  if (record(args) && typeof args.code === 'string' && args.code) return args.code;
  return typeof intent === 'string' && intent.trim() ? intent.trim() : '';
}

/** Header chips for a finished bash call: duration, exit, timeout, backgrounding. */
export function bashResultChipsHtml(details: BashToolDetails, chip: (text: string, cls?: string, title?: string) => string) {
  let html = '';
  if (details.jobId) html += chip(`⇢ ${details.jobId}`, 'job', 'Backgrounded; output arrives when the job finishes');
  else if (details.wallTimeMs != null) html += chip(formatSpan(details.wallTimeMs), 'duration', 'Execution time');
  if (details.exitCode != null && details.exitCode !== 0) html += chip(`exit ${details.exitCode}`, 'error-badge');
  if (details.timedOut) html += chip(`timed out${details.timeoutSeconds ? ` (${details.timeoutSeconds}s)` : ''}`, 'warning-badge');
  return html;
}

/** Job deadline data attributes so a later wait can show the time left. */
export function bashJobAttrs(details: BashToolDetails | undefined) {
  if (!details?.jobId) return '';
  const timeoutMs = details.timeoutDisabled ? 0 : details.timeoutSeconds != null ? details.timeoutSeconds * 1000 : null;
  return ` data-job-id="${escapeHtml(details.jobId)}"` + (timeoutMs != null ? ` data-job-timeout-ms="${timeoutMs}"` : '');
}

/**
 * Timeout of a backgrounded job, from the newest bash result that started it:
 * a number of ms, 0 for an explicitly disabled deadline, null when unknown.
 */
export function jobTimeoutMs(root: ParentNode | null | undefined, jobId: string): number | null {
  if (!root) return null;
  const matches = [...root.querySelectorAll<HTMLElement>('[data-job-id]')].filter(el => el.dataset.jobId === jobId && el.dataset.jobTimeoutMs != null);
  const raw = matches.length ? Number(matches[matches.length - 1].dataset.jobTimeoutMs) : NaN;
  return Number.isFinite(raw) && raw >= 0 ? raw : null;
}

/** A job row's live clock: elapsed and remaining time measured at one instant. */
export interface WaitJobClock { readonly elapsedMs: number; readonly leftMs: number | null; readonly noDeadline: boolean }

export function waitJobsHtml(jobs: readonly WaitJob[], clock?: (job: WaitJob) => WaitJobClock | null) {
  return '<div class="wait-jobs">' + jobs.map(job => {
    const running = job.status === 'running';
    const time = clock?.(job) ?? null;
    const elapsed = time ? time.elapsedMs : job.durationMs;
    let timing = elapsed != null ? `<span class="wait-job-time" title="${running ? 'Elapsed' : 'Run time'}">${escapeHtml(formatSpan(elapsed))}</span>` : '';
    if (running && time?.leftMs != null) timing += `<span class="wait-job-left${time.leftMs < 60_000 ? ' soon' : ''}" title="Time until the job's timeout kills it">${escapeHtml(formatSpan(time.leftMs))} left</span>`;
    else if (running && time?.noDeadline) timing += '<span class="wait-job-left" title="Started with timeout: 0">no deadline</span>';
    const exit = job.exitCode != null && job.exitCode !== 0 ? `<span class="wait-job-exit">exit ${job.exitCode}</span>` : '';
    const output = job.errorText || job.resultText;
    return `<div class="wait-job status-${escapeHtml(job.status)}">` +
      `<div class="wait-job-head"><span class="wait-job-id">${escapeHtml(job.id)}</span>` +
      (job.type ? `<span class="wait-job-type">${escapeHtml(job.type)}</span>` : '') +
      `<span class="wait-job-status">${escapeHtml(job.status)}</span>${exit}${timing}</div>` +
      (job.label ? `<pre class="tool-command wait-job-label"><code>${escapeHtml(job.label)}</code></pre>` : '') +
      (output ? `<pre class="wait-job-output${job.errorText ? ' error' : ''}">${escapeHtml(truncate(output, OUTPUT_LIMIT))}</pre>` : '') +
      '</div>';
  }).join('') + '</div>';
}

/** One-line header meta for a wait snapshot: "1 completed · 1 running". */
export function waitStatusSummary(jobs: readonly WaitJob[]) {
  const counts = new Map<string, number>();
  for (const job of jobs) counts.set(job.status, (counts.get(job.status) || 0) + 1);
  return [...counts].map(([status, n]) => `${n} ${status}`).join(' · ');
}
