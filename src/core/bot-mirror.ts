/**
 * A bot's Pi-format mirror: the transcript pi-dish lists, reads and searches.
 * The bot's durable conversation is the source of truth; the relay appends one
 * mirror entry per durable entry it shows, and gives it the id `bot-<entry>`
 * so a restarted relay knows where to continue.
 *
 * Every append is synchronous, so a reader reacting to `message_end` already
 * finds the entry on disk.
 */
import fs = require('fs');
import path = require('path');
import { record as isRecord } from './helper-values';
import type { ProtocolRecord } from './wire-protocol';

const TAIL_BYTES = 256 * 1024;
const ENTRY_ID = /^bot-(\d+)(?:-|$)/;

export interface BotMirrorHeader {
  /** The bot's id, which is also its native session id. */
  id: string;
  cwd: string;
  name: string;
}

function tail(file: string): string {
  const size = fs.statSync(file).size;
  const length = Math.min(size, TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buffer, 0, length, size - length); } finally { fs.closeSync(fd); }
  return length === size ? buffer.toString('utf8') : buffer.toString('utf8').slice(buffer.indexOf(10) + 1);
}

/** The bot id a mirror belongs to; throws when the file is not a bot mirror. */
export function readBotMirrorHeader(file: string): BotMirrorHeader {
  const first = fs.readFileSync(file, 'utf8').split('\n', 1)[0];
  let header: unknown = null;
  try { header = JSON.parse(first); } catch {}
  if (!isRecord(header) || header.type !== 'session' || typeof header.id !== 'string' || !isRecord(header.bot)) {
    throw new Error(`Not a bot mirror: ${file}`);
  }
  return { id: header.id, cwd: typeof header.cwd === 'string' ? header.cwd : '', name: String(header.bot.name ?? '') };
}

export class BotMirror {
  readonly file: string;
  private parentId: string | null = null;
  /** Newest durable entry the mirror shows; 0 for none. */
  lastEntryId = 0;
  /** The name the mirror shows now: its newest name entry, or the header's. */
  name: string;

  constructor(file: string, header: BotMirrorHeader) {
    this.file = file;
    this.name = header.name;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let exists = false;
    try { exists = fs.statSync(file).size > 0; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!exists) {
      const entry = {
        type: 'session', version: 3, id: header.id, cwd: header.cwd, timestamp: new Date().toISOString(),
        bot: { name: header.name },
      };
      fs.writeFileSync(file, JSON.stringify(entry) + '\n');
      this.append('session_info', `bot-0-name`, { name: header.name });
      return;
    }
    const lines = tail(file).split('\n');
    let named = false;
    for (let index = lines.length - 1; index >= 0; index--) {
      let entry: unknown;
      try { entry = JSON.parse(lines[index]); } catch { continue; }
      if (!isRecord(entry) || entry.type === 'session' || typeof entry.id !== 'string') continue;
      if (!named && entry.type === 'session_info' && typeof entry.name === 'string') { this.name = entry.name; named = true; }
      this.parentId ??= entry.id;
      const match = ENTRY_ID.exec(entry.id);
      if (match && !this.lastEntryId) this.lastEntryId = Number(match[1]);
      if (this.lastEntryId && named) break;
    }
  }

  private append(type: string, id: string, fields: ProtocolRecord, at = Date.now()): void {
    const entry = { type, id, parentId: this.parentId, timestamp: new Date(at).toISOString(), ...fields };
    fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
    this.parentId = id;
  }

  private advance(entryId: number): void {
    if (entryId > this.lastEntryId) this.lastEntryId = entryId;
  }

  /** A user, assistant or tool-result message, exactly as the model saw it. */
  appendMessage(entryId: number, message: ProtocolRecord): void {
    const at = typeof message.timestamp === 'number' ? message.timestamp : Date.now();
    this.append('message', `bot-${entryId}`, { message }, at);
    this.advance(entryId);
  }

  /**
   * A message the model sees as user input but the transcript shows as itself:
   * a worker's report, or the start of a new context window.
   */
  appendCustom(entryId: number, customType: string, text: string, details?: ProtocolRecord, suffix?: string): void {
    this.append('custom_message', suffix ? `bot-${entryId}-${suffix}` : `bot-${entryId}`, {
      customType, content: [{ type: 'text', text }], display: true, ...(details ? { details } : {}),
    });
    this.advance(entryId);
  }

  /** A run that ended without an answer, shown as a failed assistant turn. */
  appendRunFailure(entryId: number, taskId: number, errorMessage: string, model: { provider: string; id: string }): void {
    this.append('message', `bot-${entryId}-failed-${taskId}`, {
      message: {
        role: 'assistant', content: [], stopReason: 'error', errorMessage,
        provider: model.provider, model: model.id, timestamp: Date.now(),
      },
    });
  }

  appendModelChange(entryId: number, provider: string, modelId: string): void {
    this.append('model_change', `bot-${entryId}-model`, { provider, modelId });
  }

  /** A rename; the id is unique, as a bot may be renamed twice between two entries. */
  appendName(entryId: number, name: string): void {
    this.append('session_info', `bot-${entryId}-name-${Date.now().toString(36)}`, { name });
    this.name = name;
  }
}
