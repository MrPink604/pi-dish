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
