import type { createMessageStream } from '../../src/browser/message-stream';
declare const stream: ReturnType<typeof createMessageStream>;
// @ts-expect-error only stream lifecycle can replace the source
stream.source = new EventSource('/foreign');
// @ts-expect-error connecting requires a captured selection generation
stream.start({ id: 'same', host: 'peer' });
