import type { createNewSession, NewSessionHost } from '../../src/browser/new-session';
declare const controller: ReturnType<typeof createNewSession>;
declare const host: NewSessionHost;
// @ts-expect-error form generations advance only through its lifecycle methods
controller.generation++;
// @ts-expect-error drafts belong to open/submit and cannot be externally replaced
controller.pendingDraft = 'foreign';
// @ts-expect-error callers cannot retarget a captured host identity
host.hostId = 'foreign';
// @ts-expect-error selected model and cwd must be launch text, not arbitrary payloads
controller.submit({ model: { id: 'model' }, cwd: '/cwd' });
