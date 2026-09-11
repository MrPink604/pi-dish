import type { createComposerSpeech } from '../../src/browser/composer-speech';
import type { createComposerNotes } from '../../src/browser/composer-notes';
declare const speech: ReturnType<typeof createComposerSpeech>;
declare const notes: ReturnType<typeof createComposerNotes>;
// @ts-expect-error transcription input must be an audio blob
speech.transcribe('audio', 'audio/webm');
// @ts-expect-error note rendering accepts text only
notes.show({ html: '<button>' });
