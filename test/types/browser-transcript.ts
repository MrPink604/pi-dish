import type { createTranscript } from '../../src/browser/transcript';
declare const transcript: ReturnType<typeof createTranscript>;
// @ts-expect-error cursor writes belong to page completion
transcript.oldestIndex = 0;
// @ts-expect-error cache identity must be a host-qualified string key
transcript.deleteCached({ id: 'wrong' });
// @ts-expect-error selected request owners include generation
transcript.load({ id: 'wrong', host: 'peer' });
