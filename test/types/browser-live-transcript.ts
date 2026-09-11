import type { createLiveTools } from '../../src/browser/live-tools';
import type { createStreamingRenderer } from '../../src/browser/streaming-render';
declare const tools: ReturnType<typeof createLiveTools>;
declare const streaming: ReturnType<typeof createStreamingRenderer>;
// @ts-expect-error panel state belongs to its controller
tools.count = 0;
// @ts-expect-error completion-only mode is explicitly boolean
tools.append({}, { completionOnly: 'yes' });
// @ts-expect-error callers cannot inject an arbitrary pending owner
streaming.pending = {};
