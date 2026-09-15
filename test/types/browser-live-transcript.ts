import { decodeRenderMessage } from '../../src/browser/message-data';
import type { RenderMessage } from '../../src/browser/message-data';
import type { createLiveTools } from '../../src/browser/live-tools';
import type { createStreamingRenderer } from '../../src/browser/streaming-render';
import { createMood } from '../../src/browser/mood';
declare const tools: ReturnType<typeof createLiveTools>;
declare const streaming: ReturnType<typeof createStreamingRenderer>;
declare const document: Document;
const mood = createMood(document);
declare const raw: unknown;
declare const rawMessages: readonly unknown[];
const decoded = decodeRenderMessage(raw);
const messages: readonly RenderMessage[] = [decoded, { role: 'assistant', content: 'checked frame' }];
streaming.queue(decoded);
streaming.render(messages[1]);
mood.fromMessages(messages);
mood.fromTool('set_mood', raw);

// @ts-expect-error queued frames must already be decoded
streaming.queue(raw);
// @ts-expect-error immediate frames must already be decoded
streaming.render(raw);
// @ts-expect-error mood message scans borrow decoded rows
mood.fromMessages(rawMessages);
// @ts-expect-error queued frames cannot contain malformed telemetry
streaming.queue({ role: 'assistant', usage: { output: {} } });
// @ts-expect-error immediate frames cannot contain malformed telemetry
streaming.render({ role: 'assistant', usage: { cost: { total: 'unknown' } } });
// @ts-expect-error mood rows retain the same telemetry contract
mood.fromMessages([{ role: 'assistant', durationMs: 'slow' }]);

// @ts-expect-error panel state belongs to its controller
tools.count = 0;
// @ts-expect-error completion-only mode is explicitly boolean
tools.append({}, { completionOnly: 'yes' });
// @ts-expect-error callers cannot inject an arbitrary pending owner
streaming.pending = {};
