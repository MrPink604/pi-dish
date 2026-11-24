/**
 * Antigravity (`agy` ACP) → Pi JSONL translation and the mirror writer.
 *
 * The ACP stream is chunks and tool calls, not messages; `AcpSession` segments
 * it into Pi messages and hands the finished records here. Every entry is
 * appended synchronously so a reader that reacts to the emitted `message_end`
 * already sees the transcript. The live stream is the primary source;
 * `session/load` replay is used only to import conversations that started
 * outside pi-dish (the mirror header then records the lossy import).
 *
 * Beside the mirror (`.jsonl`) the raw frames of both directions are kept in a
 * `.acp.jsonl` sidecar as `{t, dir, msg}`, the same shape as the captures in
 * `docs/agy-acp-capture/`. No reader consumes the sidecar; it exists so the
 * mirror can be rebuilt if the translation changes.
 */
import fs = require('fs');
import path = require('path');
import crypto = require('crypto');
import { asRecord, type ProtocolRecord } from './wire-protocol';
import { record as isRecord, finite, text } from './helper-values';

/** Model provider string for every agy session (also a zero-rate plan provider). */
export const AGY_PROVIDER = 'google-antigravity';

function nonempty(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }

/** ACP `PromptResponse.usage` → Pi's usage counters. */
export function acpUsage(value: unknown): ProtocolRecord | null {
  if (!isRecord(value)) return null;
  const mapping: ReadonlyArray<readonly [string, string]> = [
    ['inputTokens', 'input'],
    ['outputTokens', 'output'],
    ['cachedReadTokens', 'cacheRead'],
    ['cachedWriteTokens', 'cacheWrite'],
    ['thoughtTokens', 'reasoning'],
    ['totalTokens', 'totalTokens'],
  ];
  const usage: ProtocolRecord = {};
  for (const [from, to] of mapping) {
    const amount = value[from];
    if (finite(amount)) usage[to] = amount;
  }
  return Object.keys(usage).length ? usage : null;
}

/** `_meta.antigravity.tier.name` from `session/new` or `session/resume`. */
export function extractAcpPlanTier(result: unknown): string | null {
  if (!isRecord(result)) return null;
  const meta = isRecord(result._meta) ? result._meta : {};
  const agy = isRecord(meta.antigravity) ? meta.antigravity : {};
  const tier = isRecord(agy.tier) ? agy.tier : {};
  const name = typeof tier.name === 'string' ? tier.name.trim() : '';
  return name ? name.slice(0, 40) : null;
}

export interface NormalizedAgyUsageLimit {
  id: string | null;
  label: string;
  windowLabel: string | null;
  resetsAt: number | null;
  usedFraction: number;
  unit: string;
  status: string;
}

export interface NormalizedAgyUsageReport {
  provider: string;
  fetchedAt: number;
  planType: string | null;
  limits: NormalizedAgyUsageLimit[];
  resetCredits: null;
}

function agyWindowLabel(windowValue: string, rawName: string, id: string): { label: string; rank: number } {
  if (windowValue === '5h') return { label: '5 hours', rank: 0 };
  if (windowValue === 'weekly') return { label: '7 days', rank: 1 };
  const stripped = rawName.replace(/\s*limit\s+remaining$/i, '').trim();
  return { label: stripped || windowValue || id || 'Quota', rank: 2 };
}

/**
 * `agy -p /usage --output-format json` → pi-dish's `/api/usage-limits` reports.
 * Only Gemini quota buckets are projected (matching agy's Gemini-only model scope).
 */
export function normalizeAgyUsageReports(
  parsed: unknown,
  options: { planType?: string | null; fetchedAt?: number } = {},
): NormalizedAgyUsageReport[] {
  const envelope = isRecord(parsed) ? parsed : {};
  if (envelope.status === 'ERROR') {
    const message = typeof envelope.error === 'string' && envelope.error.trim()
      ? envelope.error.trim()
      : 'Antigravity /usage failed';
    throw new Error(message);
  }
  const command = isRecord(envelope.command) ? envelope.command : {};
  const data = isRecord(command.data) ? command.data : {};
  if (command.name !== 'usage' || !Array.isArray(data.groups)) {
    throw new Error('Unexpected Antigravity /usage output');
  }
  const geminiGroups = data.groups.filter((group): group is ProtocolRecord =>
    isRecord(group) && !/\b(?:claude|gpt)\b/i.test(text(group.name)));
  const qualifyGroup = geminiGroups.length > 1;
  const ranked: { rank: number; limit: NormalizedAgyUsageLimit }[] = [];
  for (const group of geminiGroups) {
    const groupName = text(group.name).trim();
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    for (const raw of buckets) {
      if (!isRecord(raw)) continue;
      const id = text(raw.id).trim();
      if (id.startsWith('3p-')) continue;
      const remaining = Number(raw.remaining_fraction);
      if (!Number.isFinite(remaining)) continue;
      const usedFraction = Math.min(1, Math.max(0, 1 - remaining));
      const { label: baseLabel, rank } = agyWindowLabel(text(raw.window).trim(), text(raw.name).trim(), id);
      const label = qualifyGroup && groupName ? `${groupName} · ${baseLabel}` : baseLabel;
      const parsedReset = typeof raw.reset_time === 'string' && raw.reset_time ? Date.parse(raw.reset_time) : NaN;
      ranked.push({
        rank,
        limit: {
          id: id ? id.slice(0, 60) : null,
          label: label.slice(0, 120),
          windowLabel: baseLabel.slice(0, 60),
          resetsAt: Number.isFinite(parsedReset) ? parsedReset : null,
          usedFraction,
          unit: 'percent',
          status: remaining <= 0 ? 'exhausted' : 'ok',
        },
      });
    }
  }
  ranked.sort((a, b) => a.rank - b.rank || a.limit.label.localeCompare(b.limit.label));
  if (!ranked.length) return [];
  const planType = typeof options.planType === 'string' && options.planType.trim()
    ? options.planType.trim().slice(0, 40)
    : null;
  return [{
    provider: AGY_PROVIDER,
    fetchedAt: finite(options.fetchedAt) ? options.fetchedAt : Date.now(),
    planType,
    limits: ranked.map(entry => entry.limit),
    resetCredits: null,
  }];
}

/**
 * ACP stop reasons → Pi's assistant `stopReason` vocabulary. Both ACP limits
 * (`max_tokens`, `max_turn_requests`) are `length`; callers keep the ACP value
 * in `rawStopReason`.
 */
export function acpStopReason(value: unknown): string {
  switch (value) {
    case 'end_turn': return 'stop';
    case 'max_tokens': return 'length';
    case 'max_turn_requests': return 'length';
    case 'cancelled': return 'aborted';
    case 'refusal': return 'error';
    default: return 'stop';
  }
}

export interface AcpToolCall {
  /** Pi-dish tool name the existing cards understand. */
  toolName: string;
  args: ProtocolRecord;
  /** agy's own tool name, kept for diagnostics and question matching. */
  nativeName: string;
  title: string;
  kind: string;
}

function locationPath(update: ProtocolRecord): string {
  const locations = Array.isArray(update.locations) ? update.locations : [];
  for (const row of locations) {
    if (!isRecord(row)) continue;
    if (nonempty(row.path)) return row.path;
  }
  return '';
}

/** agy sends its native call in non-ACP `name`/`args` next to ACP's `title`/`kind`. */
export function normalizeAcpTool(update: unknown): AcpToolCall {
  const value = isRecord(update) ? update : {};
  const nativeName = nonempty(value.name) ? value.name : 'tool';
  const args = isRecord(value.args) ? value.args : (isRecord(value.rawInput) ? value.rawInput : {});
  const filePath = nonempty(args.Path) ? args.Path : locationPath(value);
  const title = nonempty(value.title) ? value.title : nativeName;
  const kind = text(value.kind);
  switch (nativeName) {
    case 'run_command':
      return { toolName: 'bash', args: { command: text(args.CommandLine) }, nativeName, title, kind };
    case 'read_file':
      return { toolName: 'read', args: { path: filePath }, nativeName, title, kind };
    case 'edit_file':
      return { toolName: 'edit', args: { path: filePath, oldText: text(args.Target), newText: text(args.Replacement) }, nativeName, title, kind };
    case 'write_file':
      return { toolName: 'write', args: { path: filePath, content: text(args.Content) }, nativeName, title, kind };
    default:
      return { toolName: nativeName, args, nativeName, title, kind };
  }
}

const DIFF_CONTEXT = 3;
const DIFF_LINE_LIMIT = 200;

interface DiffEdit {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

function splitDiffLines(value: string): string[] {
  if (!value) return [];
  return value.replace(/\n$/, '').split('\n');
}

function uniqueLineMap(lines: readonly string[], start: number, end: number): Map<string, number> {
  const seen = new Map<string, number>();
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    seen.set(line, seen.has(line) ? -1 : i);
  }
  return seen;
}

function patienceEdits(oldLines: readonly string[], newLines: readonly string[],
  start: number, oldEnd: number, newEnd: number): DiffEdit[] {
  const oldUnique = uniqueLineMap(oldLines, start, oldEnd);
  const newUnique = uniqueLineMap(newLines, start, newEnd);
  const pairs: { oldIdx: number; newIdx: number }[] = [];
  for (const [line, oldIdx] of oldUnique) {
    if (oldIdx < 0) continue;
    const newIdx = newUnique.get(line);
    if (newIdx !== undefined && newIdx >= 0) pairs.push({ oldIdx, newIdx });
  }
  const tails: number[] = [];
  const prev = new Array<number>(pairs.length).fill(-1);
  for (let i = 0; i < pairs.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]].newIdx < pairs[i].newIdx) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const anchors: { oldIdx: number; newIdx: number }[] = [];
  for (let cur = tails.length ? tails[tails.length - 1] : -1; cur >= 0; cur = prev[cur]) anchors.push(pairs[cur]);
  anchors.reverse();

  const edits: DiffEdit[] = [];
  let prevOld = start, prevNew = start;
  for (const anchor of anchors) {
    if (anchor.oldIdx < prevOld || anchor.newIdx < prevNew) continue;
    let oi = anchor.oldIdx, ni = anchor.newIdx;
    while (oi > prevOld && ni > prevNew && oldLines[oi - 1] === newLines[ni - 1]) { oi--; ni--; }
    let len = 1;
    while (oi + len < oldEnd && ni + len < newEnd && oldLines[oi + len] === newLines[ni + len]) len++;
    if (prevOld < oi || prevNew < ni) edits.push({ oldStart: prevOld, oldEnd: oi, newStart: prevNew, newEnd: ni });
    prevOld = oi + len;
    prevNew = ni + len;
  }
  if (prevOld < oldEnd || prevNew < newEnd) {
    edits.push({ oldStart: prevOld, oldEnd, newStart: prevNew, newEnd });
  }
  return edits;
}

/**
 * Whole-file diff blocks arrive as `{type:'diff', path, oldText, newText}`; split
 * unchanged spans into bounded unified diff hunks so single- and multi-region
 * edits on large files never copy the whole file into the JSONL mirror.
 */
function diffText(block: ProtocolRecord): string {
  const filePath = text(block.path);
  const oldLines = splitDiffLines(text(block.oldText));
  const newLines = splitDiffLines(text(block.newText));
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) {
    suffix++;
  }
  const head = filePath ? `${filePath}\n` : '';
  if (prefix === oldLines.length && prefix === newLines.length) return `${head}(no changes)`;
  const edits = patienceEdits(oldLines, newLines, prefix, oldLines.length - suffix, newLines.length - suffix);
  const groups: DiffEdit[][] = [];
  for (const edit of edits) {
    const current = groups[groups.length - 1];
    if (current && edit.oldStart - current[current.length - 1].oldEnd <= DIFF_CONTEXT * 2) current.push(edit);
    else groups.push([edit]);
  }
  const rendered: string[] = [];
  for (const group of groups) {
    const first = group[0], last = group[group.length - 1];
    const hunkOldStart = Math.max(0, first.oldStart - DIFF_CONTEXT);
    const hunkOldEnd = Math.min(oldLines.length, last.oldEnd + DIFF_CONTEXT);
    const hunkNewStart = Math.max(0, first.newStart - DIFF_CONTEXT);
    const hunkNewEnd = Math.min(newLines.length, last.newEnd + DIFF_CONTEXT);
    const oldCount = hunkOldEnd - hunkOldStart;
    const newCount = hunkNewEnd - hunkNewStart;
    rendered.push(`@@ -${oldCount ? hunkOldStart + 1 : 0},${oldCount} +${newCount ? hunkNewStart + 1 : 0},${newCount} @@`);
    let cursorOld = hunkOldStart;
    for (const edit of group) {
      while (cursorOld < edit.oldStart) rendered.push(` ${oldLines[cursorOld++]}`);
      for (let i = edit.oldStart; i < edit.oldEnd; i++) rendered.push(`-${oldLines[i]}`);
      for (let j = edit.newStart; j < edit.newEnd; j++) rendered.push(`+${newLines[j]}`);
      cursorOld = edit.oldEnd;
    }
    while (cursorOld < hunkOldEnd) rendered.push(` ${oldLines[cursorOld++]}`);
  }
  const omitted = rendered.length - DIFF_LINE_LIMIT;
  const body = omitted > 0 ? [...rendered.slice(0, DIFF_LINE_LIMIT), `... (${omitted} more diff lines)`] : rendered;
  return `${head}${body.join('\n')}`;
}

export interface AcpImageBlock {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface AcpToolResult {
  text: string;
  images?: AcpImageBlock[];
  details?: ProtocolRecord;
}

const MAX_INBOUND_IMAGE_BYTES = 10 * 1024 * 1024;
const ACP_IMAGE_MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function stripDataUrlPrefix(raw: string): { data: string; mimeType: string | null } {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(raw.trim());
  return m ? { data: m[2], mimeType: m[1].toLowerCase() } : { data: raw.trim(), mimeType: null };
}

function readSafeLocalImage(rawUriOrPath: string, explicitMime: string | null, allowedRoots?: readonly string[]): AcpImageBlock | null {
  if (!allowedRoots?.length || !rawUriOrPath) return null;
  let localPath = rawUriOrPath;
  if (/^file:\/\//i.test(localPath)) {
    try { localPath = decodeURIComponent(new URL(localPath).pathname); } catch { return null; }
  }
  if (!path.isAbsolute(localPath)) return null;
  const normFile = path.resolve(localPath);
  const extMime = ACP_IMAGE_MIME_BY_EXT[path.extname(normFile).toLowerCase()] ?? null;
  const mimeType = explicitMime && explicitMime.startsWith('image/') ? explicitMime : extMime;
  if (!mimeType) return null;
  let permitted = false;
  for (const root of allowedRoots) {
    if (!root || !path.isAbsolute(root)) continue;
    const normRoot = path.resolve(root);
    const normPrefix = normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep;
    if (!normFile.startsWith(normPrefix)) continue;
    const rel = normFile.slice(normPrefix.length);
    if (rel.split(path.sep).includes('.system_generated')) continue;
    try {
      const realRoot = fs.realpathSync(normRoot);
      const lstat = fs.lstatSync(normFile);
      if (!lstat.isFile() || lstat.isSymbolicLink() || lstat.size <= 0 || lstat.size > MAX_INBOUND_IMAGE_BYTES) continue;
      const realFile = fs.realpathSync(normFile);
      const realPrefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
      if (!realFile.startsWith(realPrefix)) continue;
      const realRel = realFile.slice(realPrefix.length);
      if (realRel.split(path.sep).includes('.system_generated')) continue;
      permitted = true;
      break;
    } catch { continue; }
  }
  if (!permitted) return null;
  try {
    return { type: 'image', data: fs.readFileSync(normFile).toString('base64'), mimeType };
  } catch {
    return null;
  }
}

/** Extract an image block from an ACP content item (`image`, image `resource` blob, or contained `resource_link`). */
export function extractAcpImageBlock(raw: unknown, allowedRoots?: readonly string[]): AcpImageBlock | null {
  if (!isRecord(raw)) return null;
  const block = isRecord(raw.content) ? raw.content : raw;
  if (block.type === 'image' && typeof block.data === 'string' && block.data.trim()) {
    const stripped = stripDataUrlPrefix(block.data);
    const mime = text(block.mimeType).toLowerCase();
    const mimeType = mime.startsWith('image/') ? mime : (stripped.mimeType || 'image/png');
    return stripped.data ? { type: 'image', data: stripped.data, mimeType } : null;
  }
  if (block.type === 'resource' && isRecord(block.resource)) {
    const res = block.resource;
    const mime = text(res.mimeType).toLowerCase();
    if (typeof res.blob === 'string' && res.blob.trim() && mime.startsWith('image/')) {
      const stripped = stripDataUrlPrefix(res.blob);
      return stripped.data ? { type: 'image', data: stripped.data, mimeType: mime } : null;
    }
    if (typeof res.uri === 'string' && res.uri) {
      return readSafeLocalImage(res.uri, mime.startsWith('image/') ? mime : null, allowedRoots);
    }
  }
  if (block.type === 'resource_link' && typeof block.uri === 'string' && block.uri) {
    const mime = text(block.mimeType).toLowerCase();
    return readSafeLocalImage(block.uri, mime.startsWith('image/') ? mime : null, allowedRoots);
  }
  return null;
}

/** Completion content plus agy's `rawOutput`; bash keeps the exit status as Pi details. */
export function acpToolResult(
  update: unknown,
  call: AcpToolCall,
  options?: { allowedRoots?: readonly string[] },
): AcpToolResult {
  const value = isRecord(update) ? update : {};
  const chunks = Array.isArray(value.content) ? value.content : [];
  const parts: string[] = [];
  const images: AcpImageBlock[] = [];
  for (const item of chunks) {
    if (!isRecord(item)) continue;
    if (item.type === 'diff') { parts.push(diffText(item)); continue; }
    const img = extractAcpImageBlock(item, options?.allowedRoots);
    if (img) { images.push(img); continue; }
    const block = isRecord(item.content) ? item.content : item;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block.type === 'resource_link' && typeof block.uri === 'string' && block.uri) {
      const mime = text(block.mimeType).toLowerCase();
      if (mime.startsWith('video/') || /\.(?:mp4|m4v|webm|mov|ogv|mkv)(?:[?#]|$)/i.test(block.uri)) {
        let target = block.uri;
        if (/^file:\/\//i.test(target)) {
          try { target = decodeURIComponent(new URL(target).pathname); } catch {}
        }
        parts.push(target);
      }
    } else if (block.type === 'resource' && isRecord(block.resource) && typeof block.resource.uri === 'string' && block.resource.uri) {
      const mime = text(block.resource.mimeType).toLowerCase();
      if (mime.startsWith('video/') || /\.(?:mp4|m4v|webm|mov|ogv|mkv)(?:[?#]|$)/i.test(block.resource.uri)) {
        let target = block.resource.uri;
        if (/^file:\/\//i.test(target)) {
          try { target = decodeURIComponent(new URL(target).pathname); } catch {}
        }
        parts.push(target);
      }
    }
  }
  const raw = isRecord(value.rawOutput) ? value.rawOutput : {};
  const output = text(raw.output);
  let body = parts.filter(Boolean).join('\n');
  if (call.nativeName === 'run_command' && output) body = output;
  else if (!body) body = output;
  if (call.nativeName === 'run_command') {
    const exitCode = raw.exit_code;
    return {
      text: body,
      ...(images.length ? { images } : {}),
      details: {
        kind: 'bash',
        timedOut: raw.timed_out === true || raw.timedOut === true,
        timeoutDisabled: true,
        ...(finite(exitCode) ? { exitCode } : {}),
      },
    };
  }
  if (call.nativeName === 'read_file' && value.status === 'completed') {
    const readPath = text(call.args.path);
    if (!images.length && readPath) {
      const localImg = readSafeLocalImage(readPath, null, options?.allowedRoots);
      if (localImg) images.push(localImg);
    }
    if (!body && !images.length) {
      return { text: readPath ? `${readPath}\n(content not reported by agy)` : '(content not reported by agy)' };
    }
  }
  return { text: body, ...(images.length ? { images } : {}) };
}

export interface NormalizedPlanEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: string;
}

/** Normalize ACP `plan` entries into structured checklist items. */
export function normalizeAcpPlan(entries: unknown): NormalizedPlanEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry): NormalizedPlanEntry[] => {
    if (!isRecord(entry)) return [];
    const content = nonempty(entry.content) ? entry.content : nonempty(entry.title) ? entry.title : null;
    if (!content) return [];
    const status: NormalizedPlanEntry['status'] = entry.status === 'completed'
      ? 'completed' : entry.status === 'in_progress' ? 'in_progress' : 'pending';
    const priority = nonempty(entry.priority) ? entry.priority : undefined;
    return [{ content, status, ...(priority ? { priority } : {}) }];
  });
}

/** ACP `plan` update → a read-only widget (empty entries clear the widget). */
export function planWidgetRequest(id: string, entries: unknown): ProtocolRecord | null {
  if (!Array.isArray(entries)) return null;
  const lines = normalizeAcpPlan(entries).map((entry) => {
    const mark = entry.status === 'completed' ? '[x]' : entry.status === 'in_progress' ? '[>]' : '[ ]';
    return `${mark} ${entry.content}`;
  });
  return { type: 'extension_ui_request', id, method: 'setWidget', widgetKey: 'agy-plan', widgetLines: lines, widgetPlacement: 'aboveEditor' };
}

export interface AcpAskOption {
  label: string;
  /** ACP form `const` sent back in the elicitation content. */
  value: string;
}
export interface AcpAskQuestionSpec {
  key: string;
  multi: boolean;
  required?: boolean;
  options: AcpAskOption[];
}
export interface AcpAsk {
  request: ProtocolRecord;
  questions: AcpAskQuestionSpec[];
}

function stripRecommended(label: string): { label: string; recommended: boolean } {
  const match = /^\(recommended\)\s*/i.exec(label);
  return match ? { label: label.slice(match[0].length), recommended: true } : { label, recommended: false };
}

function schemaOptionEntries(raw: ProtocolRecord): ProtocolRecord[] {
  const items = isRecord(raw.items) ? raw.items as ProtocolRecord : null;
  const fromBranch = (candidate: unknown): ProtocolRecord[] | null => {
    if (!Array.isArray(candidate)) return null;
    const rows = candidate.filter(isRecord) as ProtocolRecord[];
    return rows.length ? rows : null;
  };
  const direct = fromBranch(raw.oneOf) ?? fromBranch(raw.anyOf)
    ?? (items ? (fromBranch(items.anyOf) ?? fromBranch(items.oneOf)) : null);
  if (direct) return direct;
  const fromEnum = (holder: ProtocolRecord | null): ProtocolRecord[] | null => {
    if (!holder || !Array.isArray(holder.enum) || !holder.enum.length) return null;
    const names = Array.isArray(holder.enumNames) ? holder.enumNames : [];
    return holder.enum.map((val, idx): ProtocolRecord => ({
      const: val,
      title: typeof names[idx] === 'string' && names[idx] ? names[idx] : String(val),
    }));
  };
  return fromEnum(raw) ?? fromEnum(items) ?? [];
}

/**
 * One `elicitation/create` form → the browser's `ask` dialog. Each non-`_other`
 * property is a question; supports single-select (`oneOf`/`enum`) and
 * multi-select (`type: 'array'` with `items.anyOf`/`items.oneOf`/`items.enum`).
 */
export function askFromElicitation(id: string, params: unknown, pendingQuestions: unknown): AcpAsk | null {
  const record = isRecord(params) ? params : {};
  const schema = isRecord(record.requestedSchema) ? record.requestedSchema : {};
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const requiredKeys = new Set(Array.isArray(schema.required) ? schema.required.filter((k): k is string => typeof k === 'string') : []);
  const pending = Array.isArray(pendingQuestions) ? pendingQuestions : [];
  const questions: AcpAskQuestionSpec[] = [];
  const display: ProtocolRecord[] = [];
  let questionIndex = 0;
  for (const [key, raw] of Object.entries(properties)) {
    if (key.endsWith('_other') || !isRecord(raw)) continue;
    const pendingQuestion = isRecord(pending[questionIndex]) ? pending[questionIndex] as ProtocolRecord : {};
    const multi = raw.type === 'array' || pendingQuestion.is_multi_select === true;
    const required = requiredKeys.has(key);
    const pendingOptions = Array.isArray(pendingQuestion.options) ? pendingQuestion.options : [];
    const entries = schemaOptionEntries(raw as ProtocolRecord);
    const options: AcpAskOption[] = [];
    let recommended: number | null = null;
    const count = Math.max(entries.length, pendingOptions.length);
    for (let i = 0; i < count; i++) {
      const entry = entries[i];
      const pendingOption = pendingOptions[i];
      const pendingLabel = typeof pendingOption === 'string' ? pendingOption
        : isRecord(pendingOption) ? text(pendingOption.label) || text(pendingOption.title) : '';
      const strippedPending = stripRecommended(pendingLabel);
      const rawLabel = entry ? text(entry.title) || text(entry.label) : '';
      const strippedRaw = stripRecommended(rawLabel);
      const label = strippedRaw.label || strippedPending.label;
      if (!label) continue;
      const value = entry && entry.const !== undefined ? String(entry.const)
        : isRecord(pendingOption) && pendingOption.value !== undefined ? String(pendingOption.value) : label;
      if ((strippedPending.recommended || strippedRaw.recommended) && recommended === null) {
        recommended = options.length;
      }
      options.push({ label, value });
    }
    const question = text(raw.title) || text(pendingQuestion.question) || `Question ${key}`;
    questions.push({ key, multi, ...(required ? { required: true } : {}), options });
    display.push({
      id: key,
      question,
      header: text(raw.description),
      multi,
      recommended,
      options: options.map(option => ({ label: option.label, description: '', preview: '' })),
    });
    questionIndex++;
  }
  if (!questions.length) return null;
  return {
    request: {
      type: 'extension_ui_request',
      id,
      method: 'ask',
      title: text(record.message) || 'Question',
      questions: display,
    },
    questions,
  };
}

const ASK_OPTION_LIMIT = 64;

/** The browser's ask response → the elicitation result (`accept` / `decline` / `cancel`). */
export function askElicitationResult(response: ProtocolRecord, questions: readonly AcpAskQuestionSpec[]): ProtocolRecord {
  if (response.cancelled === true) return { action: 'cancel' };
  const value = isRecord(response.value) ? response.value : {};
  if (value.kind === 'chat') return { action: 'decline' };
  if (value.kind !== 'submit' || !Array.isArray(value.results)) return { action: 'cancel' };
  const content: ProtocolRecord = {};
  for (const question of questions) {
    const row = value.results.slice(0, ASK_OPTION_LIMIT).find(item => isRecord(item) && item.id === question.key);
    if (!isRecord(row)) continue;
    const selected = Array.isArray(row.selectedOptions)
      ? row.selectedOptions.filter((item): item is string => typeof item === 'string')
      : [];
    const values = selected.flatMap(label => {
      const match = question.options.find(option => option.label === label);
      return match ? [match.value] : [];
    });
    if (values.length) content[question.key] = question.multi ? values : values[0];
    else if (question.multi && question.required) content[question.key] = [];
    const custom = typeof row.customInput === 'string' ? row.customInput.trim() : '';
    if (custom) content[`${question.key}_other`] = custom;
  }
  return { action: 'accept', content };
}

export interface AcpPermissionOption {
  optionId: string;
  label: string;
}

/** An unexpected permission request becomes a `select` dialog rather than hanging the turn. */
export function permissionDialog(id: string, params: unknown): { request: ProtocolRecord; options: AcpPermissionOption[] } | null {
  const record = isRecord(params) ? params : {};
  const raw = Array.isArray(record.options) ? record.options : [];
  const options: { optionId: string; label: string; description: string }[] = [];
  for (const row of raw) {
    if (!isRecord(row) || typeof row.optionId !== 'string' || !row.optionId) continue;
    options.push({ optionId: row.optionId, label: text(row.name) || row.optionId, description: text(row.kind) });
  }
  if (!options.length) return null;
  const call = isRecord(record.toolCall) ? record.toolCall : {};
  return {
    options: options.map(option => ({ optionId: option.optionId, label: option.label })),
    request: {
      type: 'extension_ui_request',
      id,
      method: 'select',
      title: 'Permission required',
      message: text(call.title) || text(call.name) || text(record.sessionId) || 'Antigravity requested permission',
      options: options.map(option => ({ label: option.label, description: option.description })),
    },
  };
}

/** The select response → ACP's `{outcome:{outcome:'selected'|'cancelled'}}`. */
export function permissionResult(response: ProtocolRecord, options: readonly AcpPermissionOption[]): ProtocolRecord {
  if (response.cancelled === true) return { outcome: { outcome: 'cancelled' } };
  const label = typeof response.value === 'string' ? response.value : '';
  const match = options.find(option => option.label === label) ?? options.find(option => option.optionId === label);
  return match
    ? { outcome: { outcome: 'selected', optionId: match.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

/** `session/load` rebuilds a lossy history; the header says so for the UI/docs. */
export interface AcpMirrorImport {
  at: number;
  source: 'session/load';
}

export interface AcpTranscriptOptions {
  file: string;
  sessionId: string;
  cwd: string;
  agentVersion: string | null;
  imported?: AcpMirrorImport | null;
}

export interface AcpMirrorHeader {
  id: string;
  cwd: string | null;
  agentVersion: string | null;
  imported: AcpMirrorImport | null;
}

const TAIL_BYTES = 1024 * 1024;

function lastEntryIdIn(content: string): string | null {
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (isRecord(entry) && entry.type !== 'session' && nonempty(entry.id)) return entry.id;
    } catch { /* A torn tail line cannot anchor the chain. */ }
  }
  return null;
}

/** Mirrors reach tens of MB; read the tail unless one entry exceeds the window. */
function tailSlice(file: string): { text: string; complete: boolean } {
  const stats = fs.statSync(file);
  const length = Math.min(stats.size, TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buffer, 0, length, stats.size - length); } finally { fs.closeSync(fd); }
  return { text: buffer.toString('utf8'), complete: length === stats.size };
}

function lastTimestampIn(content: string): number | null {
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (!isRecord(entry) || entry.type === 'session') continue;
      if (typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)) return entry.timestamp;
      if (typeof entry.timestamp === 'string') {
        const at = Date.parse(entry.timestamp);
        if (Number.isFinite(at)) return at;
      }
    } catch { /* A torn tail line cannot date the mirror. */ }
  }
  return null;
}

/** Timestamp of the mirror's newest entry; null when it has none (or no file). */
export function readAcpMirrorLastTimestamp(file: string): number | null {
  try {
    const tail = tailSlice(file);
    const found = lastTimestampIn(tail.text);
    if (found !== null || tail.complete) return found;
    return lastTimestampIn(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

export interface AcpMirrorBackup {
  mirror: string | null;
  sidecar: string | null;
}

/** Rename a mirror and sidecar aside before re-import; `.bak` never matches discovery. */
export function backupAcpMirror(file: string): AcpMirrorBackup {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sidecar = file.replace(/\.jsonl$/, '.acp.jsonl');
  const move = (from: string): string | null => {
    const to = `${from}.${stamp}.bak`;
    try { fs.renameSync(from, to); return to; } catch { return null; }
  };
  return { mirror: move(file), sidecar: move(sidecar) };
}

/** Put a backup back after a failed replay so resume can fall back to `session/resume`. */
export function restoreAcpMirror(file: string, backup: AcpMirrorBackup): void {
  const sidecar = file.replace(/\.jsonl$/, '.acp.jsonl');
  const restore = (from: string | null, to: string): void => {
    if (!from) return;
    try { fs.rmSync(to, { force: true }); fs.renameSync(from, to); } catch { /* Best effort. */ }
  };
  restore(backup.mirror, file);
  restore(backup.sidecar, sidecar);
}

/** Read the mirror header (id, cwd, agy version); throws when the file is not a mirror. */
export function readAcpMirrorHeader(file: string): AcpMirrorHeader {
  const buffer = Buffer.alloc(4096);
  const fd = fs.openSync(file, 'r');
  let read = 0;
  try { read = fs.readSync(fd, buffer, 0, buffer.length, 0); } finally { fs.closeSync(fd); }
  const first = buffer.subarray(0, read).toString('utf8').split('\n')[0];
  let header: unknown;
  try { header = JSON.parse(first); } catch { header = null; }
  if (!isRecord(header) || header.type !== 'session' || !nonempty(header.id)) {
    throw new Error(`Not an Antigravity session mirror: ${file}`);
  }
  const agy = isRecord(header.agy) ? header.agy : {};
  const rawImport = isRecord(agy.imported) ? agy.imported : null;
  const imported = rawImport && typeof rawImport.source === 'string'
    ? { at: finite(rawImport.at) ? rawImport.at : Date.parse(text(rawImport.at)) || 0, source: rawImport.source as AcpMirrorImport['source'] }
    : null;
  return {
    id: header.id,
    cwd: nonempty(header.cwd) ? header.cwd : null,
    agentVersion: nonempty(agy.version) ? agy.version : null,
    imported,
  };
}

/** Linear parent chain; agy has no branches, so every entry extends the last. */
export class AcpTranscript {
  readonly file: string;
  readonly sidecarFile: string;
  private parentId: string | null = null;
  private replayUserText: string | null = null;
  private replayAssistant: ProtocolRecord | null = null;

  constructor(options: AcpTranscriptOptions) {
    this.file = options.file;
    this.sidecarFile = options.file.replace(/\.jsonl$/, '.acp.jsonl');
    fs.mkdirSync(path.dirname(options.file), { recursive: true });
    let size = 0;
    try { size = fs.statSync(options.file).size; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (size > 0) {
      const tail = tailSlice(options.file);
      this.parentId = lastEntryIdIn(tail.text);
      if (!this.parentId && !tail.complete) {
        this.parentId = lastEntryIdIn(fs.readFileSync(options.file, 'utf8'));
      }
      return;
    }
    const header = {
      type: 'session',
      version: 3,
      id: options.sessionId,
      cwd: options.cwd,
      timestamp: new Date().toISOString(),
      agy: {
        version: options.agentVersion,
        ...(options.imported
          ? { imported: { at: new Date(options.imported.at).toISOString(), source: options.imported.source } }
          : {}),
      },
    };
    fs.writeFileSync(options.file, JSON.stringify(header) + '\n');
  }

  /** Append one entry; `timestamp` is the Pi entry stamp, not the message start. */
  private entry(type: string, fields: ProtocolRecord, at = Date.now()): ProtocolRecord {
    const entry: ProtocolRecord = {
      type,
      id: crypto.randomUUID(),
      parentId: this.parentId,
      timestamp: new Date(at).toISOString(),
      ...fields,
    };
    fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
    this.parentId = entry.id as string;
    return entry;
  }

  appendUser(content: string | readonly ProtocolRecord[], timestamp = Date.now()): void {
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
    this.entry('message', { message: { role: 'user', content: blocks, timestamp } });
  }

  /** `message` is the finished assistant snapshot emitted on `message_end`. */
  appendAssistant(message: ProtocolRecord, at?: number): void {
    this.entry('message', { message }, at);
  }

  appendToolResult(data: {
    toolCallId: string;
    toolName: string;
    content: string;
    images?: readonly AcpImageBlock[];
    isError?: boolean;
    details?: ProtocolRecord;
    timestamp?: number;
  }): void {
    const blocks: ProtocolRecord[] = [];
    if (data.content || !data.images?.length) blocks.push({ type: 'text', text: data.content });
    for (const img of data.images ?? []) {
      blocks.push({ type: 'image', data: img.data, mimeType: img.mimeType });
    }
    this.entry('message', {
      message: {
        role: 'toolResult',
        toolCallId: data.toolCallId,
        toolName: data.toolName,
        content: blocks,
        isError: data.isError === true,
        timestamp: data.timestamp ?? Date.now(),
        ...(data.details ? { details: data.details } : {}),
      },
    });
  }

  appendModelChange(modelId: string): void {
    this.entry('model_change', { modelId, provider: AGY_PROVIDER });
  }

  appendThinkingLevel(thinkingLevel: string): void {
    this.entry('thinking_level_change', { thinkingLevel });
  }

  appendSessionInfo(name: string): void {
    this.entry('session_info', { name });
  }

  /**
   * `session/load` replay: user chunks carry whole prompts, assistant text and
   * completed tool calls arrive without updates or prompt results. A user chunk
   * closes the previous message; a completed/failed call is start plus end; the
   * load response flushes whatever is still open (`flushReplay`).
   */
  applyReplayUpdate(raw: unknown, options?: { allowedRoots?: readonly string[] }): void {
    const update = isRecord(raw) ? raw : {};
    const kind = text(update.sessionUpdate);
    if (kind === 'user_message_chunk') {
      const content = asRecord(update.content);
      if (content.type !== 'text') return;
      this.flushReplay();
      this.replayUserText = text(content.text);
      return;
    }
    if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const content = asRecord(update.content);
      if (kind === 'agent_message_chunk' && content.type !== 'text') {
        const img = extractAcpImageBlock(content, options?.allowedRoots);
        if (!img) return;
        this.flushReplayUser();
        this.ensureReplayAssistant();
        (this.replayAssistant!.content as ProtocolRecord[]).push({ type: 'image', data: img.data, mimeType: img.mimeType });
        return;
      }
      if (content.type !== 'text') return;
      this.flushReplayUser();
      this.ensureReplayAssistant();
      const message = this.replayAssistant!;
      const blocks = message.content as ProtocolRecord[];
      const type = kind === 'agent_thought_chunk' ? 'thinking' : 'text';
      const last = blocks[blocks.length - 1];
      if (isRecord(last) && last.type === type) {
        const key = type === 'text' ? 'text' : 'thinking';
        last[key] = text(last[key]) + text(content.text);
      } else {
        blocks.push(type === 'text'
          ? { type: 'text', text: text(content.text) }
          : { type: 'thinking', thinking: text(content.text) });
      }
      return;
    }
    if (kind !== 'tool_call') return;
    const status = text(update.status);
    const call = normalizeAcpTool(update);
    const toolCallId = text(update.toolCallId) || `call-replay-${crypto.randomUUID()}`;
    this.flushReplayUser();
    this.ensureReplayAssistant();
    (this.replayAssistant!.content as ProtocolRecord[]).push({
      type: 'toolCall', id: toolCallId, name: call.toolName, arguments: call.args,
    });
    this.flushReplayAssistant('toolUse');
    if (status !== 'completed' && status !== 'failed') return;
    const result = acpToolResult(update, call, options);
    this.appendToolResult({
      toolCallId,
      toolName: call.toolName,
      content: result.text,
      ...(result.images?.length ? { images: result.images } : {}),
      isError: status === 'failed',
      ...(result.details ? { details: result.details } : {}),
    });
  }

  /** The `session/load` response ends the replay; write the open message. */
  flushReplay(): void {
    this.flushReplayAssistant('stop');
    this.flushReplayUser();
  }

  private ensureReplayAssistant(): void {
    if (this.replayAssistant) return;
    const message: ProtocolRecord = {
      role: 'assistant',
      content: [],
      timestamp: Date.now(),
      provider: AGY_PROVIDER,
    };
    this.replayAssistant = message;
  }

  private flushReplayAssistant(stopReason: string): void {
    const message = this.replayAssistant;
    if (!message) return;
    this.replayAssistant = null;
    message.stopReason = stopReason;
    this.appendAssistant(message);
  }

  private flushReplayUser(): void {
    const content = this.replayUserText;
    if (content === null) return;
    this.replayUserText = null;
    this.appendUser(content);
  }

  /** Raw frame sidecar: `{t, dir, msg}` exactly as the capture recorder wrote it. */
  appendRaw(dir: 'in' | 'out', msg: unknown): void {
    try {
      fs.appendFileSync(this.sidecarFile, JSON.stringify({ t: Date.now(), dir, msg }) + '\n');
    } catch { /* A missing sidecar directory must not break the transport. */ }
  }
}
