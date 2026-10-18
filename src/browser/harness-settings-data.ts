export interface HarnessConfig {
  readonly defaultModel: string;
  readonly defaultThinkingLevel: string;
  readonly globalModelRoles: Readonly<Record<string, string>>;
  readonly modelRoles: Readonly<Record<string, string>>;
}
export interface HarnessAgent {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly model: string;
  readonly thinkingLevel: string;
}
export interface AgentSettings {
  readonly disabled: readonly string[];
  readonly modelOverrides: Readonly<Record<string, string>>;
  readonly prewalk: Readonly<Record<string, boolean>>;
  readonly advisor: Readonly<Record<string, boolean>>;
}
export interface HarnessAgents {
  readonly agents: readonly HarnessAgent[];
  readonly settings: AgentSettings | null;
  readonly globalSettings: AgentSettings | null;
}
export interface HarnessAgentPatch {
  disabled?: boolean;
  model?: string | null;
  prewalk?: boolean | null;
  advisor?: boolean | null;
}
export interface HarnessSettingsPatch {
  roles: Record<string, string | null>;
  agents: Record<string, HarnessAgentPatch>;
  /** Settings-panel key → value; null resets the key to the harness default. */
  settings: Record<string, unknown>;
}
/** One row of the harness's own settings panel, as the global config stores it. */
export interface HarnessSetting {
  readonly key: string;
  readonly tab: string;
  readonly type: string;
  readonly description: string;
  readonly values: readonly string[] | null;
  readonly value: unknown;
  /** A configured credential: the value never crosses the wire. */
  readonly redacted: boolean;
  /** The cwd's effective value when a project config overrides the global one. */
  readonly override: { readonly value: unknown } | null;
}
export interface HarnessSettingsList {
  readonly tabs: readonly { readonly id: string; readonly label: string }[];
  readonly settings: readonly HarnessSetting[];
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
const text = (value: unknown) => typeof value === 'string' ? value : '';
export function stringRecord(value: unknown): Readonly<Record<string, string>> {
  const result = Object.fromEntries(record(value) ? Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string') : []);
  Object.setPrototypeOf(result, null);
  return result;
}
function booleanRecord(value: unknown): Readonly<Record<string, boolean>> {
  const result = Object.fromEntries(record(value) ? Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean') : []);
  Object.setPrototypeOf(result, null);
  return result;
}
export function decodeHarnessConfig(value: unknown): HarnessConfig {
  if (!record(value)) throw new Error('Invalid harness configuration');
  return { defaultModel: text(value.defaultModel), defaultThinkingLevel: text(value.defaultThinkingLevel),
    globalModelRoles: stringRecord(value.globalModelRoles), modelRoles: stringRecord(value.modelRoles) };
}
function settings(value: unknown): AgentSettings | null {
  if (!record(value)) return null;
  return { disabled: Array.isArray(value.disabled) ? value.disabled.filter((name): name is string => typeof name === 'string') : [],
    modelOverrides: stringRecord(value.modelOverrides), prewalk: booleanRecord(value.prewalk), advisor: booleanRecord(value.advisor) };
}
export function decodeHarnessAgents(value: unknown): HarnessAgents {
  if (!record(value)) throw new Error('Invalid harness agents');
  const agents: unknown[] = Array.isArray(value.agents) ? value.agents : [];
  return { agents: agents.flatMap(agent => record(agent) && typeof agent.name === 'string' && agent.name
    ? [{ name: agent.name, description: text(agent.description), source: text(agent.source), model: text(agent.model), thinkingLevel: text(agent.thinkingLevel) }] : []),
  settings: settings(value.settings), globalSettings: settings(value.globalSettings) };
}
export function decodeHarnessSettings(value: unknown): HarnessSettingsList {
  if (!record(value) || !Array.isArray(value.tabs) || !Array.isArray(value.settings)) throw new Error('Invalid harness settings');
  const tabs = value.tabs.flatMap(tab => record(tab) && typeof tab.id === 'string' && tab.id
    ? [{ id: tab.id, label: text(tab.label) || tab.id }] : []);
  const known = new Set(tabs.map(tab => tab.id));
  const settings = value.settings.flatMap((row): HarnessSetting[] => {
    if (!record(row) || typeof row.key !== 'string' || !row.key || typeof row.tab !== 'string' || !known.has(row.tab)) return [];
    const values = Array.isArray(row.values) ? row.values.filter((entry): entry is string => typeof entry === 'string') : null;
    return [{ key: row.key, tab: row.tab, type: text(row.type), description: text(row.description), values,
      value: row.value, redacted: row.redacted === true, override: record(row.override) ? { value: row.override.value } : null }];
  });
  return { tabs, settings };
}
