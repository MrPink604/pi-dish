import type { SessionEntry } from './session-state';
import { record, finite } from './helper-values';
import { decodeRenderMessage } from './message-data';
const cursor = (value: unknown) => finite(value) && Number.isInteger(value) && value >= 0 ? value : null;
export function decodeTranscriptPage(value: unknown) {
  if (!record(value) || !Array.isArray(value.messages)) throw new Error('Invalid transcript page');
  const session: Partial<SessionEntry> = record(value.session) ? { ...value.session } : {};
  delete session.id; delete session.host;
  return { messages: value.messages.map(decodeRenderMessage), session, firstIndex: cursor(value.firstIndex), lastIndex: cursor(value.lastIndex), hasMore: value.hasMore === true, totalMessages: cursor(value.totalMessages) };
}
