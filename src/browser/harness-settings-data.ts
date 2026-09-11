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
