import { createSpawnTargets, createSpawnTargetPicker } from '../../src/browser/spawn-targets';
import type { DirectoryHost } from '../../src/browser/directory-catalog';
declare const host: DirectoryHost;
declare const input: HTMLInputElement;
declare const container: HTMLElement;
const controller = createSpawnTargets({ host: () => host, supportsTmux: () => true,
  request: async () => new Response(), readSaved: () => null, save: key => { key.toLowerCase(); }, changed: () => {} });
controller.resume(host);
const target = controller.selected('new-name');
if (target && 'tmuxSession' in target) target.tmuxSession.toLowerCase();
// @ts-expect-error callers cannot inject unowned target choices
controller.choices().push({ label: 'injected', target: null });
// @ts-expect-error target descriptors are readonly views
if (controller.current().target) controller.current().target.socket = '/retarget';
// @ts-expect-error resume requires the host route, not an ambiguous id
controller.resume('host-a');
createSpawnTargetPicker({ input, nameInput: input, wrap: container, dropdown: container, targets: controller,
  match: () => [], score: () => 0, highlight: text => text, escapeHtml: text => text });
