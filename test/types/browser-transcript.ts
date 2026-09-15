import { decodeTranscriptPage } from '../../src/browser/transcript-data';
import type { RenderMessage } from '../../src/browser/message-data';
import type { createTranscript } from '../../src/browser/transcript';
declare const transcript: ReturnType<typeof createTranscript>;
declare const options: Parameters<typeof createTranscript>[0];
declare const raw: unknown;
declare const rawMessages: readonly unknown[];
const page = decodeTranscriptPage(raw);
const messages: readonly RenderMessage[] = page.messages;
transcript.render(messages);
options.updateMood(messages);
options.renderMessage(messages[0]);

// @ts-expect-error transcript rendering requires decoded rows
transcript.render(rawMessages);
// @ts-expect-error render callbacks cannot accept wire input
options.renderMessage(raw);
// @ts-expect-error mood callbacks cannot accept wire input
options.updateMood(rawMessages);
// @ts-expect-error malformed telemetry cannot enter transcript rendering
transcript.render([{ role: 'assistant', usage: { output: {} } }]);
// @ts-expect-error callbacks preserve the decoded telemetry contract
options.renderMessage({ role: 'assistant', durationMs: 'slow' });
// @ts-expect-error mood callbacks retain numeric timing fields
options.updateMood([{ role: 'assistant', outputTokens: 'many' }]);
// @ts-expect-error decoded page arrays cannot be replaced
page.messages = [];
// @ts-expect-error decoded page arrays cannot be sorted in place
page.messages.sort();
// @ts-expect-error decoded page metadata is borrowed
page.session.model = 'other';

// @ts-expect-error cursor writes belong to page completion
transcript.oldestIndex = 0;
// @ts-expect-error cache identity must be a host-qualified string key
transcript.deleteCached({ id: 'wrong' });
// @ts-expect-error selected request owners include generation
transcript.load({ id: 'wrong', host: 'peer' });
