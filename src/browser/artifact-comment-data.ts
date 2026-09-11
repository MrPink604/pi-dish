/** Published pages accept only the comment fields their overlay consumes. */
export interface TextAnchor {
  readonly type: 'text';
  readonly quote: string;
  readonly prefix: string;
  readonly suffix: string;
}
export interface PageComment {
  readonly id: string;
  readonly sessionId: string;
  readonly body: string;
  readonly target: Readonly<{ anchor: TextAnchor }>;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function comments(value: unknown): readonly unknown[] {
  return record(value) && Array.isArray(value.comments) ? value.comments : [];
}
export function decodeCommentEntries(value: unknown): readonly Readonly<{ id: string; sessionId: string }>[] {
  return comments(value).flatMap(entry => record(entry) && typeof entry.id === 'string'
    && entry.id && typeof entry.sessionId === 'string' && entry.sessionId
    ? [{ id: entry.id, sessionId: entry.sessionId }] : []);
}
export function decodePageComments(value: unknown): readonly PageComment[] {
  return comments(value).flatMap(entry => {
    if (!record(entry) || typeof entry.id !== 'string' || !entry.id
      || typeof entry.sessionId !== 'string' || !entry.sessionId || typeof entry.body !== 'string'
      || !record(entry.target) || !record(entry.target.anchor)) return [];
    const anchor = entry.target.anchor;
    if (typeof anchor.quote !== 'string' || !anchor.quote) return [];
    return [{ id: entry.id, sessionId: entry.sessionId, body: entry.body,
      target: { anchor: { type: 'text' as const, quote: anchor.quote,
        prefix: typeof anchor.prefix === 'string' ? anchor.prefix : '',
        suffix: typeof anchor.suffix === 'string' ? anchor.suffix : '' } } }];
  });
}
export function responseError(value: unknown, status: number): string {
  return record(value) && typeof value.error === 'string' && value.error ? value.error : `HTTP ${status}`;
}
