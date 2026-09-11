import type { createComposerDrafts } from '../../src/browser/composer-drafts';
import type { ComposerImage } from '../../src/browser/composer-images';
declare const drafts: ReturnType<typeof createComposerDrafts>;
declare const image: ComposerImage;
// @ts-expect-error composer owner changes go through state writers
drafts.key = 'peer session';
// @ts-expect-error attachments are immutable through the read view
drafts.images.current().push(image);
// @ts-expect-error restored payload text is typed
drafts.restorePayload('session', { text: 'message' }, null);
