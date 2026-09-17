import type { createSessionView } from '../../src/browser/session-view';
import type { createSessionResume } from '../../src/browser/session-resume';
declare const view: ReturnType<typeof createSessionView>;
declare const resume: ReturnType<typeof createSessionResume>;
// @ts-expect-error provisional identity is owned by selection
view.spawnId = 'foreign';
// @ts-expect-error session selection flags are explicit booleans
view.select('same', { forceTranscriptReload: 'yes' });
// @ts-expect-error resume model reads need a session identity
resume.load({ harnessId: 'omp' });

declare const selectionPorts: Parameters<typeof createSessionView>[0];
// @ts-expect-error selection can restore a draft, not migrate another owner's draft
selectionPorts.drafts.migrate('spawn:foreign', 'host session');
// @ts-expect-error selection seeds activity but does not initiate an abort
selectionPorts.activity.beginAbort('host session');
// @ts-expect-error selection cannot replace transcript pages directly
selectionPorts.transcript.render([]);
// @ts-expect-error selection stops connections without disposing the stream owner
selectionPorts.stream.dispose();
// @ts-expect-error selecting an inactive session must not launch its harness
selectionPorts.resume.resume();
