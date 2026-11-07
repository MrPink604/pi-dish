import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import type { RequestHandler } from 'express';
import type { HarnessDescriptor } from './contracts';
import { getHarness, listHarnesses } from './harnesses';
import { listTaskAgents } from './harness-agents';
import { harnessCommandAvailable, runHarnessJsonCommand, runHarnessTextCommand } from './harness-feature-commands';
import { errorMessage, requestBody } from './http-boundary';

type Handler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, Record<string, unknown>>;
interface AgentSettings {
  disabled: string[];
  modelOverrides: Record<string, string>;
  prewalk: Record<string, boolean>;
  advisor: Record<string, boolean>;
}
interface AgentPatch {
  disabled?: boolean | null;
  model?: string | null;
  prewalk?: boolean | null;
  advisor?: boolean | null;
}
function valueOf(result: unknown): unknown {
  return result && typeof result === 'object' && 'value' in result ? result.value : undefined;
}

type HandlerRequest = Parameters<Handler>[0];
type HandlerResponse = Parameters<Handler>[1];

interface HarnessRoute {
  supported(descriptor: HarnessDescriptor): boolean;
  unsupported(descriptor: HarnessDescriptor): string;
  run(descriptor: HarnessDescriptor, req: HandlerRequest, res: HandlerResponse): Promise<unknown>;
  errorStatus?(error: unknown): number;
}

function harnessRoute({ supported, unsupported, run, errorStatus = () => 500 }: HarnessRoute): Handler {
  return async (req, res) => {
    const descriptor = getHarness(req.params.id);
    if (!descriptor) return res.status(404).json({ error: 'Unknown harness' });
    if (!supported(descriptor)) return res.status(501).json({ error: unsupported(descriptor) });
    try {
      await run(descriptor, req, res);
    } catch (e) {
      res.status(errorStatus(e)).json({ error: errorMessage(e) });
    }
  };
}

/** Undefined when absent; null after answering 400 when it is not a string. */
function optionalCwd(res: HandlerResponse, value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') { res.status(400).json({ error: 'cwd must be a string' }); return null; }
  return value;
}

const MODEL_ROLE_KEY = /^[a-zA-Z][\w.-]{0,63}$/;
const MODEL_ROLE_VALUE_MAX = 200;
const AGENT_NAME_KEY = /^[A-Za-z0-9][\w.-]{0,63}$/;

function sanitizeModelRoles(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim()));
}

// `config get` merges project-over-global but `config set` writes global, so a
// round trip would leak project overrides into global; an empty dir reads global alone.
async function inEmptyDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-global-'));
  try {
    return await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function readGlobalConfigValues(descriptor: HarnessDescriptor, keys: string[]): Promise<unknown[]> {
  return inEmptyDir(async dir => (await Promise.all(keys.map(key => runHarnessJsonCommand(
    descriptor, descriptor.argv.configGet!(key), { cwd: dir })))).map(valueOf));
}

async function readGlobalModelRoles(descriptor: HarnessDescriptor): Promise<Record<string, string>> {
  const [value] = await readGlobalConfigValues(descriptor, [descriptor.pilotConfig!.modelRoles]);
  return sanitizeModelRoles(value);
}

async function readHarnessPilotConfig(descriptor: HarnessDescriptor, cwd?: string) {
  const keys = descriptor.pilotConfig;
  if (!keys || typeof descriptor.argv.configGet !== 'function') return null;
  const [rolesResult, thinkingResult, globalModelRoles] = await Promise.all([
    runHarnessJsonCommand(descriptor, descriptor.argv.configGet(keys.modelRoles), { cwd }),
    runHarnessJsonCommand(descriptor, descriptor.argv.configGet(keys.defaultThinkingLevel), { cwd }),
    readGlobalModelRoles(descriptor),
  ]);
  const modelRoles = sanitizeModelRoles(valueOf(rolesResult));
  const defaultModel = typeof modelRoles.default === 'string' ? modelRoles.default : null;
  const thinking = valueOf(thinkingResult);
  const defaultThinkingLevel = typeof thinking === 'string' ? thinking : null;
  return { defaultModel, defaultThinkingLevel, modelRoles, globalModelRoles };
}

const AGENT_SETTING_KEYS = ['disabledAgents', 'agentModelOverrides', 'agentPrewalk', 'agentAdvisor'];

function agentSettingsSupported(descriptor: HarnessDescriptor): boolean {
  const keys = descriptor.pilotConfig;
  return !!(keys && descriptor.taskAgents && AGENT_SETTING_KEYS.every(key => keys[key]));
}

function sanitizeNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(name => typeof name === 'string' && AGENT_NAME_KEY.test(name)))];
}

// OMP may store these toggles as booleans or "on"/"off"; both collapse to a boolean.
function sanitizeFlagRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const flags: Record<string, boolean> = {};
  for (const [name, flag] of Object.entries(value as Record<string, unknown>)) {
    if (!AGENT_NAME_KEY.test(name)) continue;
    if (typeof flag === 'boolean') flags[name] = flag;
    else if (flag === 'on' || flag === 'true') flags[name] = true;
    else if (flag === 'off' || flag === 'false') flags[name] = false;
  }
  return flags;
}

function shapeAgentSettings([disabled, modelOverrides, prewalk, advisor]: unknown[]): AgentSettings {
  return {
    disabled: sanitizeNameList(disabled),
    modelOverrides: sanitizeModelRoles(modelOverrides),
    prewalk: sanitizeFlagRecord(prewalk),
    advisor: sanitizeFlagRecord(advisor),
  };
}

function agentSettingKeyList(descriptor: HarnessDescriptor): string[] {
  return AGENT_SETTING_KEYS.map(key => descriptor.pilotConfig![key]);
}

// Rows edit global; a differing effective value is the project's override in that cwd.
async function readAgentSettings(descriptor: HarnessDescriptor, cwd?: string) {
  const keys = agentSettingKeyList(descriptor);
  const [effective, global] = await Promise.all([
    Promise.all(keys.map(key => runHarnessJsonCommand(
      descriptor, descriptor.argv.configGet!(key), { cwd }).then(valueOf))),
    readGlobalConfigValues(descriptor, keys),
  ]);
  return { settings: shapeAgentSettings(effective), globalSettings: shapeAgentSettings(global) };
}

// Writes are whole-value read-modify-writes; serialize per harness so concurrent PUTs don't drop patches.
const harnessConfigWrites = new Map<string, Promise<unknown>>();
function queueHarnessConfigWrite<T>(harnessId: string, task: () => Promise<T>): Promise<T> {
  // The stored link swallows failures so one failed write can't reject the queue behind it.
  const chained = (harnessConfigWrites.get(harnessId) || Promise.resolve()).then(() => task());
  harnessConfigWrites.set(harnessId, chained.catch(() => {}));
  return chained;
}

interface SettingRow {
  key: string;
  tab: string;
  type: string;
  description: string;
  values?: string[];
  value?: unknown;
  redacted?: true;
  override?: { value: unknown };
}
class SettingInputError extends Error {}

const SETTING_KEY = /^[A-Za-z][\w.-]{0,127}$/;
const SETTING_VALUE_MAX = 64 * 1024;
const ANSI_SGR = /\u001b\[[0-9;]*m/g;

function settingsSupported(descriptor: HarnessDescriptor): boolean {
  const argv = descriptor.argv;
  return !!(descriptor.settingsTabs && argv.configList && argv.configSchema
    && typeof argv.configSet === 'function' && typeof argv.configReset === 'function');
}

// The human `config list` alone carries `[tab]` headings and enum `a|b|c` types;
// join to the JSON listing by key. First row wins so multi-line values can't shadow it.
function parseSettingsSchema(text: string): Map<string, { tab: string; typeDisplay: string }> {
  const rows = new Map<string, { tab: string; typeDisplay: string }>();
  let tab = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(ANSI_SGR, '');
    const heading = /^\[([\w-]+)\]$/.exec(line);
    if (heading) { tab = heading[1]; continue; }
    const row = /^ {2}(\S+) = .*\(([^()]*)\)$/.exec(line);
    if (row && tab && !rows.has(row[1])) rows.set(row[1], { tab, typeDisplay: row[2] });
  }
  return rows;
}

function listedSettings(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unexpected settings listing');
  const result: Record<string, Record<string, unknown>> = Object.create(null);
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SETTING_KEY.test(key) && entry && typeof entry === 'object' && !Array.isArray(entry)) result[key] = entry as Record<string, unknown>;
  }
  return result;
}

// Settings with no TUI tab ("internal") are not offered.
async function readSettings(descriptor: HarnessDescriptor, cwd?: string) {
  const [schemaText, globalList, effectiveList] = await inEmptyDir(dir => Promise.all([
    runHarnessTextCommand(descriptor, descriptor.argv.configSchema!, { cwd: dir }),
    runHarnessJsonCommand(descriptor, descriptor.argv.configList!, { cwd: dir }),
    cwd ? runHarnessJsonCommand(descriptor, descriptor.argv.configList!, { cwd }) : null,
  ]));
  const schema = parseSettingsSchema(schemaText);
  const global = listedSettings(globalList);
  const effective = effectiveList === null ? null : listedSettings(effectiveList);
  const settings: SettingRow[] = [];
  for (const [key, entry] of Object.entries(global)) {
    const meta = schema.get(key);
    if (!meta || meta.tab === 'internal' || typeof entry.type !== 'string') continue;
    const row: SettingRow = { key, tab: meta.tab, type: entry.type, description: typeof entry.description === 'string' ? entry.description : '' };
    if (entry.type === 'enum' && meta.typeDisplay.includes('|')) row.values = meta.typeDisplay.split('|');
    if (entry.redacted === true) row.redacted = true;
    else if (entry.value !== undefined) row.value = entry.value;
    const local = effective?.[key];
    if (local && !row.redacted && local.redacted !== true
        && JSON.stringify(local.value) !== JSON.stringify(row.value)) row.override = { value: local.value ?? null };
    settings.push(row);
  }
  const order = descriptor.settingsTabs || [];
  const tabIds = [...new Set(settings.map(row => row.tab))].sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    return ai >= 0 && bi >= 0 ? ai - bi : ai >= 0 ? -1 : bi >= 0 ? 1 : a.localeCompare(b);
  });
  return { tabs: tabIds.map(id => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) })), settings, cwd: cwd || '' };
}

// The CLI parses one argv entry (JSON for arrays/records, else trimmed text). A
// leading `-` would read as a flag, so such text gets a leading space the CLI trims.
function settingArgument(row: SettingRow, value: unknown): string {
  const fail = (expected: string) => { throw new SettingInputError(`Invalid value for ${row.key}: expected ${expected}`); };
  let text: string;
  switch (row.type) {
    case 'boolean':
      if (typeof value !== 'boolean') fail('a boolean');
      text = String(value);
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('a finite number');
      text = String(value);
      break;
    case 'enum':
      if (typeof value !== 'string' || (row.values && !row.values.includes(value))) fail(row.values ? row.values.join(', ') : 'a string');
      text = value as string;
      break;
    case 'string':
      if (typeof value !== 'string') fail('a string');
      text = value as string;
      break;
    case 'array':
      if (!Array.isArray(value)) fail('an array');
      text = JSON.stringify(value);
      break;
    case 'record':
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('an object');
      text = JSON.stringify(value);
      break;
    default:
      throw new SettingInputError(`${row.key} has an unsupported setting type: ${row.type}`);
  }
  if (text.length > SETTING_VALUE_MAX) fail(`at most ${SETTING_VALUE_MAX} characters`);
  return text.startsWith('-') ? ` ${text}` : text;
}

export const harnesses: Handler = (_req, res) => {
  res.json({
    harnesses: listHarnesses().map(descriptor => ({
      id: descriptor.id,
      label: descriptor.label,
      available: harnessCommandAvailable(descriptor),
      rpcFallback: descriptor.rpcFallback,
      closeMode: descriptor.closeMode,
      privateSessions: typeof descriptor.privateRootPath === 'function',
      // Settings view: pilot defaults plus model roles, and the task-agent hub where supported.
      pilotConfig: !!descriptor.pilotConfig,
      taskAgents: agentSettingsSupported(descriptor),
    })),
  });
};

export const harnessConfig = harnessRoute({
  supported: descriptor => !!descriptor.pilotConfig,
  unsupported: descriptor => `Pilot config is not supported for ${descriptor.label}.`,
  async run(descriptor, req, res) {
    const cwd = optionalCwd(res, req.query.cwd);
    if (cwd === null) return;
    res.json(await readHarnessPilotConfig(descriptor, cwd));
  },
});

// Values are stored verbatim: the harness resolves model refs itself.
export const updateModelRoles = harnessRoute({
  supported: descriptor => !!descriptor.pilotConfig && typeof descriptor.argv.configSet === 'function',
  unsupported: descriptor => `Model roles are not editable for ${descriptor.label}.`,
  async run(descriptor, req, res) {
    const { roles, cwd } = requestBody(req);
    const cwdValue = optionalCwd(res, cwd);
    if (cwdValue === null) return;
    if (!roles || typeof roles !== 'object' || Array.isArray(roles)) {
      return res.status(400).json({ error: 'roles must be an object mapping role names to model refs' });
    }
    const patch = Object.entries(roles as Record<string, unknown>);
    if (!patch.length) return res.status(400).json({ error: 'roles must name at least one role' });
    for (const [role, model] of patch) {
      if (!MODEL_ROLE_KEY.test(role)) {
        return res.status(400).json({ error: `Invalid role name: ${role}` });
      }
      if (model === null) continue;
      if (typeof model !== 'string' || !model.trim() || model.length > MODEL_ROLE_VALUE_MAX) {
        return res.status(400).json({ error: `Invalid model for role ${role}: expected null or a non-empty model ref of at most ${MODEL_ROLE_VALUE_MAX} characters` });
      }
    }
    res.json(await queueHarnessConfigWrite(descriptor.id, async () => {
      const record = await readGlobalModelRoles(descriptor);
      for (const [role, model] of patch as [string, string | null][]) {
        if (model === null) delete record[role]; else record[role] = model;
      }
      await runHarnessJsonCommand(descriptor,
        descriptor.argv.configSet!(descriptor.pilotConfig!.modelRoles, JSON.stringify(record)));
      const [globalModelRoles, effective] = await Promise.all([
        readGlobalModelRoles(descriptor),
        runHarnessJsonCommand(descriptor, descriptor.argv.configGet!(descriptor.pilotConfig!.modelRoles), { cwd: cwdValue }),
      ]);
      return { globalModelRoles, modelRoles: sanitizeModelRoles(valueOf(effective)) };
    }));
  },
});

// Task-agent inventory with the per-agent settings the harness's own hub edits.
export const harnessAgents = harnessRoute({
  supported: agentSettingsSupported,
  unsupported: descriptor => `Task agents are not configurable for ${descriptor.label}.`,
  async run(descriptor, req, res) {
    const cwd = optionalCwd(res, req.query.cwd);
    if (cwd === null) return;
    const [agents, settings] = await Promise.all([
      listTaskAgents(descriptor, runHarnessJsonCommand, { cwd }),
      readAgentSettings(descriptor, cwd),
    ]);
    res.json({ agents, ...settings, cwd: cwd || '' });
  },
});

// Fields are tri-state: a value sets it; null drops the override and inherits again.
export const updateHarnessAgents = harnessRoute({
  supported: descriptor => agentSettingsSupported(descriptor) && typeof descriptor.argv.configSet === 'function',
  unsupported: descriptor => `Task agents are not configurable for ${descriptor.label}.`,
  async run(descriptor, req, res) {
    const { agents, cwd } = requestBody(req);
    const cwdValue = optionalCwd(res, cwd);
    if (cwdValue === null) return;
    if (!agents || typeof agents !== 'object' || Array.isArray(agents)) {
      return res.status(400).json({ error: 'agents must be an object mapping agent names to settings' });
    }
    const patch = Object.entries(agents as Record<string, unknown>);
    if (!patch.length) return res.status(400).json({ error: 'agents must name at least one agent' });
    for (const [name, settings] of patch) {
      if (!AGENT_NAME_KEY.test(name)) return res.status(400).json({ error: `Invalid agent name: ${name}` });
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return res.status(400).json({ error: `Invalid settings for agent ${name}` });
      }
      const fields = settings as Record<string, unknown>;
      for (const field of ['disabled', 'prewalk', 'advisor']) {
        const value = fields[field];
        if (value !== undefined && value !== null && typeof value !== 'boolean') {
          return res.status(400).json({ error: `Invalid ${field} for agent ${name}: expected a boolean or null` });
        }
      }
      const model = fields.model;
      if (model !== undefined && model !== null
          && (typeof model !== 'string' || !model.trim() || model.length > MODEL_ROLE_VALUE_MAX)) {
        return res.status(400).json({ error: `Invalid model for agent ${name}: expected null or a non-empty model ref of at most ${MODEL_ROLE_VALUE_MAX} characters` });
      }
    }
    res.json(await queueHarnessConfigWrite(descriptor.id, async () => {
      const keys = agentSettingKeyList(descriptor);
      const record = shapeAgentSettings(await readGlobalConfigValues(descriptor, keys));
      const disabled = new Set(record.disabled);
      const dirty = new Set<string>();
      const setOverride = <T extends string | boolean>(bucket: Record<string, T>, key: string, name: string, value: T | null | undefined) => {
        if (value === undefined) return;
        if (value === null) {
          if (!Object.hasOwn(bucket, name)) return;
          delete bucket[name];
        } else {
          if (bucket[name] === value) return;
          bucket[name] = value;
        }
        dirty.add(key);
      };
      for (const [name, settings] of patch as [string, AgentPatch][]) {
        if (settings.disabled !== undefined && settings.disabled !== null
            && settings.disabled !== disabled.has(name)) {
          if (settings.disabled) disabled.add(name); else disabled.delete(name);
          dirty.add(descriptor.pilotConfig!.disabledAgents);
        }
        setOverride(record.modelOverrides, descriptor.pilotConfig!.agentModelOverrides, name, settings.model);
        setOverride(record.prewalk, descriptor.pilotConfig!.agentPrewalk, name, settings.prewalk);
        setOverride(record.advisor, descriptor.pilotConfig!.agentAdvisor, name, settings.advisor);
      }
      const values: Record<string, unknown> = {
        [descriptor.pilotConfig!.disabledAgents]: [...disabled],
        [descriptor.pilotConfig!.agentModelOverrides]: record.modelOverrides,
        [descriptor.pilotConfig!.agentPrewalk]: record.prewalk,
        [descriptor.pilotConfig!.agentAdvisor]: record.advisor,
      };
      // Rewrite only dirty keys: a whole-value set on an untouched key would materialize a global copy.
      for (const key of keys) {
        if (dirty.has(key)) {
          await runHarnessJsonCommand(descriptor, descriptor.argv.configSet!(key, JSON.stringify(values[key])));
        }
      }
      return readAgentSettings(descriptor, cwdValue);
    }));
  },
});

export const listHarnessSettings = harnessRoute({
  supported: settingsSupported,
  unsupported: descriptor => `Settings are not editable for ${descriptor.label}.`,
  async run(descriptor, req, res) {
    const cwd = optionalCwd(res, req.query.cwd);
    if (cwd === null) return;
    res.json(await readSettings(descriptor, cwd));
  },
});

// null resets to the harness default; all keys/values are validated before the first write.
export const updateHarnessSettings = harnessRoute({
  supported: settingsSupported,
  unsupported: descriptor => `Settings are not editable for ${descriptor.label}.`,
  errorStatus: error => (error instanceof SettingInputError ? 400 : 500),
  async run(descriptor, req, res) {
    const { settings, cwd } = requestBody(req);
    const cwdValue = optionalCwd(res, cwd);
    if (cwdValue === null) return;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({ error: 'settings must be an object mapping setting keys to values' });
    }
    const patch = Object.entries(settings as Record<string, unknown>);
    if (!patch.length) return res.status(400).json({ error: 'settings must name at least one setting' });
    for (const [key] of patch) {
      if (!SETTING_KEY.test(key)) return res.status(400).json({ error: `Invalid setting key: ${key}` });
    }
    res.json(await queueHarnessConfigWrite(descriptor.id, async () => {
      const rows = new Map((await readSettings(descriptor)).settings.map(row => [row.key, row]));
      const commands = patch.map(([key, value]) => {
        const row = rows.get(key);
        if (!row) throw new SettingInputError(`Not an editable ${descriptor.label} setting: ${key}`);
        return value === null ? descriptor.argv.configReset!(key) : descriptor.argv.configSet!(key, settingArgument(row, value));
      });
      // One CLI process per key, in order; a failure leaves earlier writes committed.
      for (const command of commands) await runHarnessJsonCommand(descriptor, command);
      return readSettings(descriptor, cwdValue);
    }));
  },
});
