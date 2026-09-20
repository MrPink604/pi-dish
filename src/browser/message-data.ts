import { record, finite } from '../core/helper-values';
import type { RefContextEntry, Timestamp } from '../core/helper-types';
import type { CacheExpiryProjection } from '../core/session-api';
export interface MessageBlock { readonly type: string; readonly text?: string; readonly thinking?: string; readonly name?: string; readonly id?: string; readonly arguments?: Readonly<Record<string, unknown>>; readonly url?: string; readonly data?: string; readonly mimeType?: string }
export interface MessageUsage { readonly input?: number; readonly output?: number; readonly reasoning?: number; readonly cacheRead?: number; readonly cacheWrite?: number; readonly cacheWrite1h?: number; readonly cost?: { readonly input?: number | null; readonly output?: number | null; readonly cacheRead?: number | null; readonly cacheWrite?: number | null; readonly total?: number | null } }
export interface AdvisorNote { readonly note: string; readonly severity?: string; readonly advisor?: string }
export interface MessageDetails { readonly notes?: readonly AdvisorNote[]; readonly jobs?: readonly { readonly label?: string; readonly jobId?: string; readonly durationMs?: number }[]; readonly from?: string; readonly message?: string }
export interface RenderMessage {
  readonly role: string; readonly id?: string; readonly index?: number; readonly timestamp?: Timestamp; readonly content?: string | readonly (MessageBlock | string)[];
  readonly model?: string; readonly responseModel?: string; readonly provider?: string; readonly stopReason?: string; readonly errorMessage?: string;
  readonly toolName?: string; readonly toolCallId?: string; readonly isError?: boolean; readonly customType?: string; readonly display?: boolean;
  readonly usage?: MessageUsage; readonly cacheExpiry?: CacheExpiryProjection; readonly durationMs?: number; readonly outputTokens?: number; readonly sessionRefs?: readonly RefContextEntry[]; readonly details?: MessageDetails;
}
const string = (value: unknown) => typeof value === 'string' ? value : undefined;
const number = (value: unknown) => finite(value) ? value : undefined;
export function decodeMessageUsage(value: unknown): MessageUsage | undefined {
  if (!record(value)) return undefined;
  const cost = record(value.cost) ? value.cost : null, price = (value: unknown) => value === null ? null : number(value);
  return { input: number(value.input), output: number(value.output), reasoning: number(value.reasoning), cacheRead: number(value.cacheRead), cacheWrite: number(value.cacheWrite), cacheWrite1h: number(value.cacheWrite1h),
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
function decodeCacheExpiry(value: unknown): CacheExpiryProjection | undefined {
  if (!record(value) || !finite(value.refreshedAt) || !finite(value.expiresAt) || !finite(value.retentionMs) ||
      typeof value.retention !== 'string' || !['fixed', 'minimum', 'estimate'].includes(String(value.basis))) return undefined;
  return { refreshedAt: value.refreshedAt, expiresAt: value.expiresAt, retentionMs: value.retentionMs,
    retention: value.retention, basis: value.basis as CacheExpiryProjection['basis'] };
}
export function decodeRenderMessage(value: unknown): RenderMessage {
  const row = record(value) ? value : {}, details = record(row.details) ? row.details : null;
  return { role: string(row.role) || '', id: string(row.id), index: finite(row.index) && Number.isInteger(row.index) && row.index >= 0 ? row.index : undefined,
    timestamp: row.timestamp instanceof Date ? new Date(row.timestamp.getTime()) : typeof row.timestamp === 'string' || finite(row.timestamp) ? row.timestamp : undefined,
    content: decodeMessageContent(row.content), model: string(row.model), responseModel: string(row.responseModel), provider: string(row.provider), stopReason: string(row.stopReason), errorMessage: string(row.errorMessage),
    toolName: string(row.toolName), toolCallId: string(row.toolCallId), isError: row.isError === true, customType: string(row.customType), display: typeof row.display === 'boolean' ? row.display : undefined,
    usage: decodeMessageUsage(row.usage), cacheExpiry: decodeCacheExpiry(row.cacheExpiry), durationMs: number(row.durationMs), outputTokens: number(row.outputTokens),
    sessionRefs: Array.isArray(row.sessionRefs) ? row.sessionRefs.flatMap((entry: unknown): RefContextEntry[] => record(entry) && typeof entry.ref === 'string' ? [{ ref: entry.ref, name: string(entry.name), host: string(entry.host), cwd: string(entry.cwd), isActive: entry.isActive === true }] : []) : undefined,
    details: details ? { notes: Array.isArray(details.notes) ? details.notes.flatMap((note: unknown): AdvisorNote[] => typeof note === 'string' ? [{ note }] : record(note) && typeof note.note === 'string' ? [{ note: note.note, severity: string(note.severity), advisor: string(note.advisor) }] : []) : undefined,
      jobs: Array.isArray(details.jobs) ? details.jobs.flatMap((job: unknown) => record(job) ? [{ label: string(job.label), jobId: string(job.jobId), durationMs: number(job.durationMs) }] : []) : undefined,
      from: string(details.from), message: string(details.message) } : undefined };
}
