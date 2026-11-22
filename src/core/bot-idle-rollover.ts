/**
 * Pre-expiry idle rollover for bots. A bot idle with a large window would make the next message re-read that whole
 * window once its prompt cache expires. Shortly before it expires, while a read is still cheap, the relay has the bot
 * draft its notebook in a fork of its conversation (the same prefix, so the cache is read), then opens a fresh window
 * with that notebook in one commit on the live conversation, so the next message starts small.
 *
 * The rules, the draft's request and parse, and the decision log's file live here; the timer, the fork and the
 * commit live in bot-runtime.
 */
import { createHash } from 'node:crypto';
import fs = require('fs');
import type { CacheRetentionConfig } from './cache-retention';
import { record as isRecord } from './helper-values';
import { cacheExpiryForMessage, hasCacheActivity, type CacheExpiry } from './session-metadata';

/** The key in `~/.pi/dish/settings.json`; `false` turns the feature off, an object tunes it. */
export const IDLE_ROLLOVER_SETTING = 'botIdleRollover';
/** The decision log in each bot's directory: one JSON line per plan, draft, skip, outcome and return. Best-effort. */
export const IDLE_ROLLOVER_LOG = 'idle-rollover.jsonl';
/** The draft's request must still read the cache: closer to expiry than this, it is too late. */
export const MIN_WARM_MS = 60_000;
/** Expiry bases trusted to fire: documented TTLs and floors. An estimate alone never rolls a window over. */
const TRUSTED_BASES: Readonly<Record<string, true>> = { fixed: true, minimum: true };

export interface IdleRolloverConfig {
  enabled: boolean;
  /** Trigger A: a window holding this many tokens, or `minPercent` of the window limit, whichever is lower. */
  minTokens: number;
  minPercent: number;
  /** Trigger A: only caches that live at least this long; shorter ones would roll over at every pause. */
  minRetentionMs: number;
  /** Trigger A fires this long before expiry: the larger of `leadMs` and `leadPercent` of the TTL. */
  leadMs: number;
  leadPercent: number;
  /** Trigger B: a window at least this full rolls over once idle `earlyIdleMs` while the cache is warm. */
  earlyPercent: number;
  earlyIdleMs: number;
}

export const IDLE_ROLLOVER_DEFAULTS: Readonly<IdleRolloverConfig> = Object.freeze({
  enabled: true,
  minTokens: 100_000,
  minPercent: 50,
  minRetentionMs: 30 * 60_000,
  leadMs: 3 * 60_000,
  leadPercent: 10,
  earlyPercent: 75,
  earlyIdleMs: 10 * 60_000,
});

function bounded(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

/** One settings layer over `base`: `false`/`true` sets `enabled`; invalid knobs keep the value below them. */
function applyLayer(base: IdleRolloverConfig, layer: unknown): IdleRolloverConfig {
  if (typeof layer === 'boolean') return { ...base, enabled: layer };
  if (!isRecord(layer)) return base;
  const minutes = (key: string, fallback: number) => {
    const value = bounded(layer[key], 0, 24 * 60);
    return value === null ? fallback : value * 60_000;
  };
  const percent = (key: string, fallback: number) => bounded(layer[key], 0, 100) ?? fallback;
  return {
    enabled: typeof layer.enabled === 'boolean' ? layer.enabled : base.enabled,
    minTokens: bounded(layer.minTokens, 0, 10_000_000) ?? base.minTokens,
    minPercent: percent('minPercent', base.minPercent),
    minRetentionMs: minutes('minRetentionMinutes', base.minRetentionMs),
    leadMs: minutes('leadMinutes', base.leadMs),
    leadPercent: percent('leadPercent', base.leadPercent),
    earlyPercent: percent('earlyPercent', base.earlyPercent),
    earlyIdleMs: minutes('earlyIdleMinutes', base.earlyIdleMs),
  };
}

/**
 * The configuration for one bot: the defaults, then `botIdleRollover` in settings, then its `bots` entry for this bot
 * (by id, or by name ignoring case). Either layer may be `false` to turn the feature off.
 */
export function idleRolloverConfig(settings: unknown, bot: { id: string; name: string }): IdleRolloverConfig {
  const block = isRecord(settings) ? settings[IDLE_ROLLOVER_SETTING] : undefined;
  const global = applyLayer({ ...IDLE_ROLLOVER_DEFAULTS }, block);
  const bots = isRecord(block) && isRecord(block.bots) ? block.bots : {};
  const name = bot.name.toLowerCase();
  const own = Object.hasOwn(bots, bot.id) ? bots[bot.id]
    : Object.entries(bots).find(([key]) => key.toLowerCase() === name)?.[1];
  return applyLayer(global, own);
}

/**
 * The window's prompt-cache expiry, projected through its assistant messages oldest first, as the session list
 * projects it from the bot's mirror (a warm read keeps the tier its write chose).
 */
export function windowCacheExpiry(messages: readonly unknown[], config: CacheRetentionConfig): CacheExpiry | null {
  let expiry: CacheExpiry | null = null;
  for (const message of messages) {
    if (!isRecord(message) || message.role !== 'assistant' || !hasCacheActivity(message)) continue;
    expiry = cacheExpiryForMessage(message, expiry, undefined, config);
  }
  return expiry;
}

export type IdleRolloverTrigger = 'expiry' | 'early';

export interface IdleRolloverState {
  now: number;
  config: IdleRolloverConfig;
  cache: Pick<CacheExpiry, 'expiresAt' | 'retentionMs' | 'retention' | 'basis'> | null;
  /** The window's size: the last answer's input, output and cache tokens. */
  tokens: number;
  windowLimit: number;
  /** When the bot last went idle. */
  idleSince: number;
  /** A run (a script is part of one) or input this relay is still taking. */
  busy: boolean;
  /** Input queued for the next run. */
  queued: boolean;
  /** A worker's report is being posted. */
  reportPending: boolean;
  /** This window already had its one attempt. */
  attempted: boolean;
  /** Anything happened in this window beyond its handoff. */
  workSinceRollover: boolean;
  /** The bot's next scheduled routine run; null when none. */
  nextRoutineAt: number | null;
  /** Why this bot may not roll over at all (paused, on another model than its last answer); null when it may. */
  ineligible: string | null;
}

/** What the decision log records with each plan. */
export interface IdleRolloverFacts {
  tokens: number;
  percent: number;
  expiresAt: number | null;
  retention: string | null;
  basis: string | null;
  idleMs: number;
}

export type IdleRolloverPlan = IdleRolloverFacts & (
  | { action: 'roll'; trigger: IdleRolloverTrigger }
  | { action: 'wait'; trigger: IdleRolloverTrigger; at: number }
  | { action: 'skip'; reason: string }
);

const minutesText = (ms: number) => `${Math.round(ms / 60_000)} min`;
const tokensText = (tokens: number) => `${Math.round(tokens / 1000)}k`;

/** The lead before expiry at which trigger A fires. */
export function idleRolloverLead(config: IdleRolloverConfig, retentionMs: number): number {
  return Math.max(config.leadMs, retentionMs * config.leadPercent / 100);
}

/**
 * Whether to roll the window over now, when to look again, or why not in this idle period. A skip is final until the
 * next run ends: anything that changes the answer (a turn, queued input, a report, a routine run) ends in one.
 */
export function planIdleRollover(state: IdleRolloverState): IdleRolloverPlan {
  const { now, config, cache, tokens, windowLimit } = state;
  const percent = windowLimit > 0 ? Math.round(tokens / windowLimit * 1000) / 10 : 0;
  const facts: IdleRolloverFacts = {
    tokens, percent, expiresAt: cache?.expiresAt ?? null, retention: cache?.retention ?? null,
    basis: cache?.basis ?? null, idleMs: Math.max(0, now - state.idleSince),
  };
  const skip = (reason: string): IdleRolloverPlan => ({ ...facts, action: 'skip', reason });
  if (!config.enabled) return skip('turned off in settings');
  if (state.ineligible) return skip(state.ineligible);
  if (state.attempted) return skip('already tried in this window');
  if (!state.workSinceRollover) return skip('nothing has happened since the window opened');
  if (state.busy) return skip('a turn is running');
  if (state.queued) return skip('input is queued');
  if (state.reportPending) return skip('a worker report is being delivered');
  if (!cache) return skip('no prompt-cache expiry is known');
  if (!Object.hasOwn(TRUSTED_BASES, cache.basis)) return skip(`the cache expiry's basis is ${cache.basis}, not a documented TTL`);
  const warmUntil = cache.expiresAt - MIN_WARM_MS;
  if (now >= warmUntil) return skip(now >= cache.expiresAt ? 'the cache has already expired' : 'the cache expires in under a minute');

  const floor = Math.min(config.minTokens, windowLimit * config.minPercent / 100);
  const candidates: { trigger: IdleRolloverTrigger; at: number }[] = [];
  const declined: string[] = [];
  if (cache.retentionMs < config.minRetentionMs) declined.push(`the ${cache.retention} cache is shorter than ${minutesText(config.minRetentionMs)}`);
  else if (tokens < floor) declined.push(`${tokensText(tokens)} tokens is under the ${tokensText(floor)} floor`);
  else candidates.push({ trigger: 'expiry', at: cache.expiresAt - idleRolloverLead(config, cache.retentionMs) });
  if (percent < config.earlyPercent) declined.push(`${percent}% full is under ${config.earlyPercent}%`);
  else if (state.idleSince + config.earlyIdleMs >= warmUntil) declined.push(`the cache expires before ${minutesText(config.earlyIdleMs)} idle`);
  else candidates.push({ trigger: 'early', at: state.idleSince + config.earlyIdleMs });
  if (!candidates.length) return skip(declined.join('; '));
  const next = candidates.reduce((a, b) => b.at < a.at ? b : a);
  if (state.nextRoutineAt !== null && state.nextRoutineAt >= now && state.nextRoutineAt <= cache.expiresAt) {
    return skip(`a routine runs at ${new Date(state.nextRoutineAt).toISOString()}, before the cache expires`);
  }
  return next.at > now
    ? { ...facts, action: 'wait', trigger: next.trigger, at: next.at }
    : { ...facts, action: 'roll', trigger: next.trigger };
}

/** The markers around the drafted notebook: the only answer taken is one in exactly this form. */
const OPEN = '<<<NOTEBOOK';
const CLOSE = 'NOTEBOOK>>>';
/**
 * The draft's request, sent to a fork of the conversation. It starts like the context reminder, so the reminder is not
 * added to it as well. Tools are blocked in a fork: the answer is the only thing taken from it. `notebook` is the
 * notebook as stored now: the window's instructions hold the one it opened with, and context_notes may have replaced
 * it since. It comes last, after the cached prefix, with any `</notebook>` inside it escaped so it cannot end the block.
 */
export function composeIdleDraftRequest(plan: IdleRolloverFacts, now: number, maxBytes: number, notebook: string): string {
  const left = plan.expiresAt === null ? '' : `; its prompt cache expires in about ${minutesText(Math.max(0, plan.expiresAt - now))}`;
  const stored = notebook.trim().replace(/<\/notebook>/gi, '<\\/notebook>') || '(empty)';
  return `[pi-dish: this context window is ${Math.round(plan.percent)}% full (${tokensText(plan.tokens)} tokens) and you have been idle for ${minutesText(plan.idleMs)}${left}. `
    + 'pi-dish is opening a fresh window for you now, so the next message does not re-read this one. '
    + 'Start from your notebook as it stands now, below (your instructions may show an older one), and keep what still matters. '
    + 'Tools are off for this reply, and it is not shown to the user; it comes from pi-dish, not from the user. '
    + `Reply in exactly this form and nothing else, your whole notebook at most ${maxBytes} bytes; any other reply keeps this window as it is:]\n`
    + `Summary: <one line saying what this window covered>\n${OPEN}\n<your whole new notebook>\n${CLOSE}\n\n`
    + `<notebook>\n${stored}\n</notebook>`;
}

/**
 * The summary and notebook of a draft answer, or why it is not one. Only the exact form counts: `Summary: <line>`, then
 * the notebook between its marker lines (each alone on its line, trailing blanks allowed), then nothing. Anything else
 * (a refusal, a fragment, prose around it) is a decline.
 */
export function parseNotebookDraft(text: string, maxBytes: number): { summary: string; notebook: string } | { error: string } {
  const form = /^Summary:[ \t]*([^\n]*)\n<<<NOTEBOOK[ \t]*\n([\s\S]*)\nNOTEBOOK>>>[ \t]*$/.exec(text.replace(/\r\n/g, '\n').trim());
  if (!form) return { error: `the draft is not in the Summary / ${OPEN} … ${CLOSE} form` };
  const summary = form[1].trim();
  const notebook = form[2].trim();
  if (!summary) return { error: 'the draft has an empty summary' };
  // A marker alone on a line inside the notebook means a second notebook; one mentioned in a sentence is text.
  if (notebook.split('\n').some(line => line.trim() === OPEN || line.trim() === CLOSE)) return { error: 'the draft has more than one notebook' };
  if (!notebook) return { error: 'the draft has an empty notebook' };
  const bytes = Buffer.byteLength(notebook, 'utf8');
  if (bytes > maxBytes) return { error: `the drafted notebook is ${bytes} bytes, over the ${maxBytes}-byte cap` };
  return { summary, notebook };
}

/** A notebook smaller than this is replaced whatever its draft's size. */
export const SHRINK_GUARD_MIN_BYTES = 1024;
/** A draft keeps at least this share of a larger notebook's bytes, or it is refused. */
export const SHRINK_GUARD_RATIO = 0.5;

/** Why a draft may not replace `previous`: it would drop more than half of a notebook that held something. */
export function notebookShrinkRefusal(previous: string, next: string): string | null {
  const before = Buffer.byteLength(previous.trim(), 'utf8');
  const after = Buffer.byteLength(next.trim(), 'utf8');
  if (before < SHRINK_GUARD_MIN_BYTES || after >= before * SHRINK_GUARD_RATIO) return null;
  return `the drafted notebook is ${after} bytes, under half of the ${before}-byte notebook it would replace`;
}

/** A version of a notebook: the draft is applied only over the notebook it was shown. */
export function notebookDigest(notebook: string): string {
  return createHash('sha256').update(notebook).digest('hex');
}

/** The decision log keeps its newest megabyte or two: past it, the file moves to `.1`, replacing the one before. */
export const IDLE_ROLLOVER_LOG_MAX_BYTES = 1024 * 1024;

/**
 * Appends one decision to the log, owner-only (0600) like its rotated copy. A failed rotation still appends, then
 * throws so the caller reports it; the log only grows past its cap until a rotation succeeds.
 */
export function appendDecisionLog(file: string, entry: unknown, maxBytes = IDLE_ROLLOVER_LOG_MAX_BYTES): void {
  let rotation: unknown = null;
  try {
    if (fs.statSync(file).size > maxBytes) {
      fs.renameSync(file, `${file}.1`);
      fs.chmodSync(`${file}.1`, 0o600);
    }
  } catch (error) {
    if (!isRecord(error) || error.code !== 'ENOENT') rotation = error;
  }
  const fd = fs.openSync(file, 'a', 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeSync(fd, `${JSON.stringify(entry)}\n`);
  } finally {
    fs.closeSync(fd);
  }
  if (rotation) throw new Error(`could not rotate ${file}: ${rotation instanceof Error ? rotation.message : String(rotation)}`);
}
