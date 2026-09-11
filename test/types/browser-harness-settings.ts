import { createHarnessSettings } from '../../src/browser/harness-settings';
import { decodeHarnessConfig, decodeHarnessAgents } from '../../src/browser/harness-settings-data';
declare const root: HTMLElement;
const editor = createHarnessSettings({ root, host: () => ({ hostId: 'a', base: '/a' }), request: async () => new Response(),
  fallbackModels: () => [], escapeHtml: value => value, shortCwd: value => value, roleDefinitions: [],
  parseModelRoleRef: value => ({ model: value, level: '' }), composeModelRoleRef: model => model,
  modelRoleLevels: () => [], onSaved: () => {} });
void editor.open({ hostId: 'a', harnessId: 'omp', cwd: '/cwd', label: 'OMP' });
const config = decodeHarnessConfig({});
// @ts-expect-error externally read config roles are readonly
config.globalModelRoles.smol = 'changed';
const agents = decodeHarnessAgents({});
// @ts-expect-error agent rows are readonly snapshots
agents.agents.push({});
