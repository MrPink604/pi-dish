import type { createSessionControls } from '../../src/browser/session-controls';
declare const controls: ReturnType<typeof createSessionControls>;
// @ts-expect-error controller visibility is read-only
controls.modelOpen = true;
// @ts-expect-error model selectors are strings, not request objects
controls.selectModel({ host: 'peer', modelId: 'a' });
// @ts-expect-error model enablement is boolean
controls.setAll('yes');
