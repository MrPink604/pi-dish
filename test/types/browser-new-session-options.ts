import { createNewSessionPreferences, createNewSessionConfigPreview, decodeHarnessConfigPreview } from '../../src/browser/new-session-options';
import type { CatalogModel } from '../../src/core/session-api';
declare const select: HTMLSelectElement;
declare const note: HTMLElement;
declare const rows: readonly Readonly<CatalogModel>[];
const preferences = createNewSessionPreferences({ thinking: select, hiddenNote: note, thinkingNote: note,
  rows: () => rows, read: () => null, write: () => {}, escapeHtml: text => text, rendered: () => {} });
preferences.restore('omp'); preferences.render();
const selected: string = preferences.selectedModel();
void selected;
createNewSessionConfigPreview({ wrap: note, values: note, roles: note, buttons: [note], scope: () => ({
  host: { hostId: 'a', base: '/a' }, harnessId: 'omp', cwd: '/cwd', view: 1,
}), request: async () => new Response(), roleSummary: roles => Object.values(roles).join(', ') });
const decoded = decodeHarnessConfigPreview({}, '/cwd');
// @ts-expect-error preview records are readonly
 decoded.cwd = '/other';
// @ts-expect-error callers cannot mutate decoded roles
 decoded.modelRoles.smol = 'model';
