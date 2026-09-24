import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { modelMatchesPattern } from './helper-models';
import type { CacheExpiryBasis } from './session-metadata-contracts';

export interface CacheRetentionPolicy {
  readonly retentionMs: number;
  readonly retention: string;
  readonly basis: CacheExpiryBasis;
}

interface CacheTtlRule extends CacheRetentionPolicy {
  readonly provider: string;
  readonly model: string;
}

export interface CacheRetentionConfig {
  readonly revision: string;
  readonly rules: readonly CacheTtlRule[];
}

interface CachedConfig {
  readonly stamp: string;
  readonly config: CacheRetentionConfig;
}

const CONFIG_REVISION = 1;
const MAX_RULES = 100;
export const MIN_TTL_MS = 60_000;
export const MAX_TTL_MS = 365 * 24 * 60 * 60_000;
const cache = new Map<string, CachedConfig>();

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function formatDuration(ms: number): string {
  if (ms % (24 * 60 * 60_000) === 0) return `${ms / (24 * 60 * 60_000)}d`;
  if (ms % (60 * 60_000) === 0) return `${ms / (60 * 60_000)}h`;
  return `${ms / 60_000}m`;
}

function parseDuration(value: unknown): Pick<CacheRetentionPolicy, 'retentionMs' | 'retention'> | null {
  if (typeof value !== 'string') return null;
  const match = /^([1-9]\d*)\s*([mhd])$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const unitMs = match[2].toLowerCase() === 'm' ? 60_000
    : match[2].toLowerCase() === 'h' ? 60 * 60_000
      : 24 * 60 * 60_000;
  const retentionMs = amount * unitMs;
  if (!Number.isSafeInteger(retentionMs) || retentionMs < MIN_TTL_MS || retentionMs > MAX_TTL_MS) return null;
  return { retentionMs, retention: formatDuration(retentionMs) };
}

function parseRules(value: unknown): CacheTtlRule[] {
  if (!Array.isArray(value)) return [];
  const rules: CacheTtlRule[] = [];
  for (const raw of value.slice(0, MAX_RULES)) {
    const item = record(raw);
    const ttl = parseDuration(item?.ttl);
    const provider = typeof item?.provider === 'string' ? item.provider.trim().toLowerCase() : '';
    const model = typeof item?.model === 'string' ? item.model.trim() : '';
    const basis = item?.basis === undefined ? 'fixed' : item.basis;
    if (!ttl || (!provider && !model) || provider.length > 100 || model.length > 200 ||
        (basis !== 'fixed' && basis !== 'minimum' && basis !== 'estimate')) continue;
    rules.push({ ...ttl, provider, model, basis });
  }
  return rules;
}

function readSettings(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Read the private host-level cache policy. The settings file is revalidated
 * by (mtime,size), matching the other hand-edited pi-dish configuration.
 */
export function loadCacheRetentionConfig(): CacheRetentionConfig {
  const file = path.join(os.homedir(), '.pi', 'dish', 'settings.json');
  let stamp = 'missing';
  try {
    const stats = fs.statSync(file);
    stamp = `${stats.mtimeMs}:${stats.size}`;
  } catch {}
  const existing = cache.get(file);
  if (existing?.stamp === stamp) return existing.config;
  const settings = record(readSettings(file));
  const rules = parseRules(settings?.cacheTtlOverrides);
  const digest = createHash('sha256').update(JSON.stringify(rules)).digest('hex').slice(0, 16);
  const config = { revision: `v${CONFIG_REVISION}:${digest}`, rules };
  cache.set(file, { stamp, config });
  return config;
}

export function cacheRetentionRevision(): string {
  return loadCacheRetentionConfig().revision;
}

/** First matching user rule wins; a rule may constrain provider, model, or both. */
export function configuredCacheRetention(config: CacheRetentionConfig, provider: string, model: string): CacheRetentionPolicy | null {
  const normalizedProvider = provider.toLowerCase();
  for (const rule of config.rules) {
    if (rule.provider && rule.provider !== normalizedProvider) continue;
    if (rule.model && !modelMatchesPattern(rule.model, { provider: normalizedProvider, id: model })) continue;
    return { retentionMs: rule.retentionMs, retention: rule.retention, basis: rule.basis };
  }
  return null;
}
