import { decodeSessionTranscriptPatch } from '../core/session-api';
import type { SessionTranscriptPatch } from '../core/session-api';
import { record, finite } from './helper-values';
import { decodeRenderMessage } from './message-data';
import type { RenderMessage } from './message-data';
export interface TranscriptPage {
  readonly messages: readonly RenderMessage[];
  readonly session: Readonly<SessionTranscriptPatch>;
  readonly firstIndex: number | null;
  readonly lastIndex: number | null;
  readonly hasMore: boolean;
  readonly totalMessages: number | null;
}
const cursor = (value: unknown) => finite(value) && Number.isInteger(value) && value >= 0 ? value : null;
export function decodeTranscriptPage(value: unknown): TranscriptPage {
  if (!record(value) || !Array.isArray(value.messages)) throw new Error('Invalid transcript page');
  const session = record(value.session) ? decodeSessionTranscriptPatch(value.session) : {};
  return { messages: value.messages.map(decodeRenderMessage), session, firstIndex: cursor(value.firstIndex), lastIndex: cursor(value.lastIndex), hasMore: value.hasMore === true, totalMessages: cursor(value.totalMessages) };
}
