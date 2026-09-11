import { record, finite } from './helper-values';
import type { RefContextEntry, Timestamp } from './shared-helper-types';
export interface MessageBlock { type: string; text?: string; thinking?: string; name?: string; id?: string; arguments?: Record<string, unknown>; url?: string; data?: string; mimeType?: string }
export interface MessageUsage { input?: number; output?: number; reasoning?: number; cacheRead?: number; cacheWrite?: number; cost?: { input?: number | null; output?: number | null; cacheRead?: number | null; cacheWrite?: number | null; total?: number | null } }
export interface AdvisorNote { note: string; severity?: string; advisor?: string }
export interface MessageDetails { notes?: AdvisorNote[]; jobs?: { label?: string; jobId?: string; durationMs?: number }[] }
export interface RenderMessage {
  role: string; id?: string; index?: number; timestamp?: Timestamp; content?: string | (MessageBlock | string)[];
  model?: string; responseModel?: string; provider?: string; stopReason?: string; errorMessage?: string;
  toolName?: string; toolCallId?: string; isError?: boolean; customType?: string; display?: boolean;
  usage?: MessageUsage; durationMs?: number; outputTokens?: number; sessionRefs?: RefContextEntry[]; details?: MessageDetails;
}
const string = (value: unknown) => typeof value === 'string' ? value : undefined;
const number = (value: unknown) => finite(value) ? value : undefined;
export function decodeMessageUsage(value: unknown): MessageUsage | undefined {
  if (!record(value)) return undefined;
  const cost = record(value.cost) ? value.cost : null, price = (value: unknown) => value === null ? null : number(value);
  return { input: number(value.input), output: number(value.output), reasoning: number(value.reasoning), cacheRead: number(value.cacheRead), cacheWrite: number(value.cacheWrite),
    cost: cost ? { input: price(cost.input), output: price(cost.output), cacheRead: price(cost.cacheRead), cacheWrite: price(cost.cacheWrite), total: price(cost.total) } : undefined };
}
export function decodeMessageContent(value: unknown): RenderMessage['content'] {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((block: unknown): (MessageBlock | string)[] => typeof block === 'string' ? [block] : !record(block) || typeof block.type !== 'string' ? [] : [{
    type: block.type, text: string(block.text), thinking: string(block.thinking), name: string(block.name), id: string(block.id),
    arguments: record(block.arguments) ? block.arguments : undefined, url: string(block.url), data: string(block.data), mimeType: string(block.mimeType),
  }]);
}
export function decodeRenderMessage(value: unknown): RenderMessage {
  const row = record(value) ? value : {}, details = record(row.details) ? row.details : null;
  return { role: string(row.role) || '', id: string(row.id), index: finite(row.index) && Number.isInteger(row.index) && row.index >= 0 ? row.index : undefined,
    timestamp: typeof row.timestamp === 'string' || finite(row.timestamp) || row.timestamp instanceof Date ? row.timestamp : undefined,
    content: decodeMessageContent(row.content), model: string(row.model), responseModel: string(row.responseModel), provider: string(row.provider), stopReason: string(row.stopReason), errorMessage: string(row.errorMessage),
    toolName: string(row.toolName), toolCallId: string(row.toolCallId), isError: row.isError === true, customType: string(row.customType), display: typeof row.display === 'boolean' ? row.display : undefined,
    usage: decodeMessageUsage(row.usage), durationMs: number(row.durationMs), outputTokens: number(row.outputTokens),
    sessionRefs: Array.isArray(row.sessionRefs) ? row.sessionRefs.flatMap((entry: unknown): RefContextEntry[] => record(entry) && typeof entry.ref === 'string' ? [{ ref: entry.ref, name: string(entry.name), host: string(entry.host), cwd: string(entry.cwd), isActive: entry.isActive === true }] : []) : undefined,
    details: details ? { notes: Array.isArray(details.notes) ? details.notes.flatMap((note: unknown): AdvisorNote[] => typeof note === 'string' ? [{ note }] : record(note) && typeof note.note === 'string' ? [{ note: note.note, severity: string(note.severity), advisor: string(note.advisor) }] : []) : undefined,
      jobs: Array.isArray(details.jobs) ? details.jobs.flatMap((job: unknown) => record(job) ? [{ label: string(job.label), jobId: string(job.jobId), durationMs: number(job.durationMs) }] : []) : undefined } : undefined };
}
