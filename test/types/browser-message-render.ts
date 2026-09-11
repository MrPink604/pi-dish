import type { RenderMessage } from '../../src/browser/message-data';
import type { createResponseDetails } from '../../src/browser/response-details';
declare const message: RenderMessage;
declare const details: ReturnType<typeof createResponseDetails>;
// @ts-expect-error transcript indexes cannot contain attribute text
message.index = 'bad';
// @ts-expect-error telemetry fields are narrowed before arithmetic
message.usage = { output: {} };
// @ts-expect-error metadata storage is owned by the detail controller
details.size = 0;
