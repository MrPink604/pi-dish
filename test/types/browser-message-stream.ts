import type { createMessageStream } from '../../src/browser/message-stream';
declare const stream: ReturnType<typeof createMessageStream>;
// @ts-expect-error only stream lifecycle can replace the source
stream.source = new EventSource('/foreign');
// @ts-expect-error connecting requires a captured selection generation
stream.start({ id: 'same', host: 'peer' });

declare const streamPorts: Parameters<typeof createMessageStream>[0];
// @ts-expect-error incoming events can end abort gates, not initiate user aborts
streamPorts.activity.beginAbort('host session');
// @ts-expect-error a stream cannot dispose the renderer shared with transcripts
streamPorts.renderer.dispose();
// @ts-expect-error cumulative frames must use coalescing, not direct rendering
streamPorts.streaming.render({ role: 'assistant', content: 'bypass' });
// @ts-expect-error a stream cannot clear retained tool panels from another owner
streamPorts.tools.clear(document.getElementById('messages'));
// @ts-expect-error queue events do not authorize editing queued prompts
streamPorts.delivery.edit(document.createElement('button'));
// @ts-expect-error stream events do not dispose the shared extension UI owner
streamPorts.extensionUI.dispose();
