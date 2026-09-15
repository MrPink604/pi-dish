import { decodeRenderMessage } from '../../src/browser/message-data';
import type { RenderMessage } from '../../src/browser/message-data';
import type { createResponseDetails } from '../../src/browser/response-details';
import { createMessageRenderer } from '../../src/browser/message-render';
declare const message: RenderMessage;
declare const details: ReturnType<typeof createResponseDetails>;
declare const rendererOptions: Parameters<typeof createMessageRenderer>[0];
const renderer = createMessageRenderer(rendererOptions);
declare const raw: unknown;

const decoded = decodeRenderMessage(raw);
const optimistic: RenderMessage = {
  role: 'user', timestamp: new Date(), content: [{ type: 'text', text: 'hello' }],
  sessionRefs: [{ ref: 'peer/session', name: 'Peer' }],
};
renderer.message(decoded);
renderer.user(optimistic, '');
renderer.assistant(message, '');
renderer.custom(message, '');
renderer.upsertCustom(message);
details.button(decoded);

// @ts-expect-error transcript indexes cannot contain attribute text
renderer.message({ role: 'assistant', index: 'bad' });
// @ts-expect-error general rendering requires decoded input
renderer.message(raw);
// @ts-expect-error optimistic user rendering requires checked input
renderer.user(raw, '');
// @ts-expect-error assistant rendering requires decoded input
renderer.assistant(raw, '');
// @ts-expect-error custom rendering requires decoded input
renderer.custom(raw, '');
// @ts-expect-error live custom upserts require decoded input
renderer.upsertCustom(raw);
// @ts-expect-error response detail retention requires decoded input
details.button(raw);

// @ts-expect-error malformed telemetry cannot be constructed for rendering
renderer.message({ role: 'assistant', usage: { output: {} } });
// @ts-expect-error user telemetry obeys the same decoded contract
renderer.user({ role: 'user', usage: { output: {} } }, '');
// @ts-expect-error assistant telemetry must support numeric arithmetic
renderer.assistant({ role: 'assistant', usage: { output: {} } }, '');
// @ts-expect-error custom messages cannot hide malformed telemetry
renderer.custom({ role: 'custom', usage: { output: {} } }, '');
// @ts-expect-error upserts cannot introduce malformed telemetry
renderer.upsertCustom({ role: 'custom', usage: { output: {} } });
// @ts-expect-error cost values are numeric or explicitly unavailable
details.button({ role: 'assistant', usage: { cost: { total: 'unknown' } } });

// @ts-expect-error borrowed message fields cannot be rewritten
message.model = 'other';
// @ts-expect-error borrowed content cannot be replaced
message.content = [];
if (message.content && typeof message.content !== 'string') {
  // @ts-expect-error borrowed content arrays cannot be extended
  message.content.push({ type: 'text', text: 'late' });
  const block = message.content[0];
  if (block && typeof block !== 'string') {
    // @ts-expect-error first-party content fields are readonly
    block.text = 'changed';
    if (block.arguments) {
      // @ts-expect-error tool argument records are borrowed
      block.arguments.path = 'changed';
      // @ts-expect-error arbitrary nested tool payloads remain unknown
      block.arguments.extension.label;
    }
  }
}
if (message.usage) {
  // @ts-expect-error usage fields cannot be changed by telemetry readers
  message.usage.output = 9;
  if (message.usage.cost) {
    // @ts-expect-error nullable prices are readonly too
    message.usage.cost.total = null;
  }
}
if (message.details) {
  // @ts-expect-error structured details are borrowed
  message.details.from = 'other';
  if (message.details.notes) {
    // @ts-expect-error advisor note arrays cannot be mutated
    message.details.notes.splice(0, 1);
    // @ts-expect-error advisor notes cannot be rewritten
    message.details.notes[0].note = 'changed';
  }
  if (message.details.jobs) {
    // @ts-expect-error job arrays cannot be mutated
    message.details.jobs.push({ jobId: 'late' });
    // @ts-expect-error job metadata cannot be rewritten
    message.details.jobs[0].durationMs = 0;
  }
}
if (message.sessionRefs) {
  // @ts-expect-error session reference arrays are readonly
  message.sessionRefs.push({ ref: 'other' });
  // @ts-expect-error reference hints cannot be rewritten
  message.sessionRefs[0].host = 'other';
}
// @ts-expect-error metadata storage is owned by the detail controller
details.size = 0;
