import type { RequestHandler } from 'express';
import * as harnessSettings from './harness-feature-settings';
import * as stt from './stt';
import { recoveryMode } from './recovery-runner';
import { listHarnesses } from './harnesses';
import { harnessCommandAvailable, runHarnessJsonCommand } from './harness-feature-commands';
import type { SessionCatalog } from './session-catalog-contracts';
import type { SessionSource } from './session-source-contracts';
import type { SessionOwnership } from './session-ownership';
import type { CatalogModel } from './session-api';
import type { AvailableModel } from './pi-sdk';
import { createUsageSummaryHandler } from './usage-feature-handler';
import { createSkillFeatureHandlers } from './skill-feature-handlers';
import { createModelFeatureHandlers } from './model-feature-handlers';

export type FeatureHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;

export interface FeaturePorts {
  readDishSettings(): Record<string, unknown>;
  writeDishSettings(settings: Record<string, unknown>): void;
  buildSessionCatalog(): Pick<SessionCatalog, 'list'>;
  enumerateSessionCandidates(): readonly SessionSource[];
  findSessionSource(id: string, options?: { exact?: boolean }): SessionSource | null;
  getSessionModels(id: string): Promise<CatalogModel[] | null>;
  getLiveSession: SessionOwnership['getLiveSession'];
  /** Weak listing advice only; never a command-execution authorization. */
  locatePiPane: SessionOwnership['locatePiPane'];
  getModelsCache(): { models: AvailableModel[] | null; time: number };
  /** The root setter also invalidates its context-window memo. */
  setModelsCache(models: AvailableModel[]): void;
  applicationRoot: string;
  piSettingsFile: string;
}

export interface FeatureHandlers {
  harnesses: FeatureHandler;
  harnessConfig: FeatureHandler;
  updateModelRoles: FeatureHandler;
  harnessAgents: FeatureHandler;
  updateHarnessAgents: FeatureHandler;
  transcribe: FeatureHandler;
  settings: FeatureHandler;
  updateSettings: FeatureHandler;
  usageLimits: FeatureHandler;
  usageSummary: FeatureHandler;
  skills: FeatureHandler;
  skillActivations: FeatureHandler;
  skillCoverage: FeatureHandler;
  models: FeatureHandler;
  updateEnabledModels: FeatureHandler;
  commands: FeatureHandler;
}

interface SavedFilter { name: string; query: string }

function sanitizeSavedFilters(value: unknown): SavedFilter[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const out: SavedFilter[] = [];
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    const f = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const name = typeof f.name === 'string' ? f.name.trim() : '';
    const query = typeof f.query === 'string' ? f.query.trim() : '';
    if (!name || !query || name.length > 60 || query.length > 500 || seen.has(name)) return null;
    seen.add(name);
    out.push({ name, query });
  }
  return out;
}

// Allowlist, never redaction: secrets cannot enter the client projection.
function settingsForClient(settings: Record<string, unknown>) {
  return {
    monthlyBudgetUsd: settings.monthlyBudgetUsd ?? null,
    savedFilters: sanitizeSavedFilters(settings.savedFilters) || [],
    recoveryMode: recoveryMode(settings.recoveryMode),
  };
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function normalizeUsageLimit(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const limit = optionalRecord(value);
  const amount = optionalRecord(limit.amount);
  const window = optionalRecord(limit.window);
  const usedFraction = Number(amount.usedFraction);
  if (typeof limit.label !== 'string' || !Number.isFinite(usedFraction)) return null;
  const resetsAt = Number(window.resetsAt);
  return {
    id: typeof limit.id === 'string' ? limit.id : null,
    label: limit.label.slice(0, 120),
    windowLabel: typeof window.label === 'string' ? window.label.slice(0, 60) : null,
    resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
    usedFraction,
    unit: typeof amount.unit === 'string' ? amount.unit.slice(0, 30) : null,
    status: typeof limit.status === 'string' ? limit.status.slice(0, 30) : null,
  };
}

export function createFeatureHandlers(ports: FeaturePorts): FeatureHandlers {
  const usageLimits: FeatureHandler = async (_req, res) => {
    const harnesses = listHarnesses().filter(d => d.argv.usage && harnessCommandAvailable(d));
    const results = await Promise.all(harnesses.map(async d => {
      try {
        const parsed = await runHarnessJsonCommand(d, d.argv.usage!);
        if (parsed === null || parsed === undefined) throw new TypeError(`Cannot read properties of ${parsed} (reading 'reports')`);
        const rawReports = optionalRecord(parsed).reports;
        // Even redacted upstream reports can contain account IDs/emails.
        const reports = (Array.isArray(rawReports) ? rawReports as unknown[] : []).map(value => {
          const report = optionalRecord(value);
          const metadata = optionalRecord(report.metadata);
          return {
            provider: String(report.provider || 'unknown').slice(0, 60),
            fetchedAt: Number.isFinite(Number(report.fetchedAt)) ? Number(report.fetchedAt) : null,
            planType: typeof metadata.planType === 'string' ? metadata.planType.slice(0, 40) : null,
            limits: (Array.isArray(report.limits) ? report.limits as unknown[] : []).map(normalizeUsageLimit).filter(limit => limit !== null),
          };
        }).filter(report => report.limits.length);
        return { harness: d.id, label: d.label, reports };
      } catch (e) {
        return { harness: d.id, label: d.label, error: optionalRecord(e).message };
      }
    }));
    res.json({ generatedAt: Date.now(), harnesses: results });
  };
  const settings: FeatureHandler = (_req, res) => res.json(settingsForClient(ports.readDishSettings()));
  const updateSettings: FeatureHandler = (req, res) => {
    // The JSON parser rejects primitives. Preserve the former `in` failure
    // rather than silently treating a truthy malformed body as an empty patch.
    const body = req.body || {};
    if (typeof body !== 'object') throw new TypeError(`Cannot use 'in' operator to search for 'monthlyBudgetUsd' in ${body}`);
    const settings = ports.readDishSettings();
    if ('monthlyBudgetUsd' in body) {
      const value = body.monthlyBudgetUsd;
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1_000_000)) return res.status(400).json({ error: 'monthlyBudgetUsd must be null or a positive number at most 1000000' });
      if (value === null) delete settings.monthlyBudgetUsd; else settings.monthlyBudgetUsd = value;
    }
    if ('savedFilters' in body) {
      const filters = sanitizeSavedFilters(body.savedFilters);
      if (!filters) return res.status(400).json({ error: 'savedFilters must be up to 50 { name, query } entries with unique non-empty names (≤60 chars) and queries (≤500 chars)' });
      if (filters.length === 0) delete settings.savedFilters; else settings.savedFilters = filters;
    }
    if ('recoveryMode' in body) {
      if (body.recoveryMode !== 'off' && body.recoveryMode !== 'restore' && body.recoveryMode !== 'continue') {
        return res.status(400).json({ error: 'recoveryMode must be off, restore, or continue' });
      }
      settings.recoveryMode = body.recoveryMode;
    }
    try {
      ports.writeDishSettings(settings);
      res.json(settingsForClient(settings));
    } catch (e) {
      res.status(500).json({ error: e && typeof e === 'object' && 'message' in e ? e.message : undefined });
    }
  };
  const transcribe: FeatureHandler = async (req, res) => {
    const config = stt.resolveSttConfig(ports.readDishSettings());
    if (!config) return res.status(503).json({ error: 'Speech-to-text is not configured on this host' });
    // Type before body: the local raw parser claims audio/* and video/webm only.
    const contentType = req.headers['content-type'] || '';
    if (!stt.sttFilename(contentType)) {
      return res.status(415).json({ error: `unsupported audio type ${stt.baseMimeType(contentType) || 'unknown'}` });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'audio body required' });
    try {
      const { text } = await stt.transcribe(config, { bytes: req.body, contentType });
      res.json({ text });
    } catch (e) {
      const error = e && typeof e === 'object' ? e as Record<string, unknown> : {};
      res.status(typeof error.status === 'number' && error.status ? error.status : 502).json({ error: error.message });
    }
  };
  return {
    usageSummary: createUsageSummaryHandler(ports),
    ...createSkillFeatureHandlers(ports),
    ...createModelFeatureHandlers(ports),
    usageLimits,
    settings,
    updateSettings,
    harnesses: harnessSettings.harnesses,
    harnessConfig: harnessSettings.harnessConfig,
    updateModelRoles: harnessSettings.updateModelRoles,
    harnessAgents: harnessSettings.harnessAgents,
    updateHarnessAgents: harnessSettings.updateHarnessAgents,
    transcribe,
  };
}
