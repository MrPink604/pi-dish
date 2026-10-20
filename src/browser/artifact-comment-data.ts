/** Published pages accept only the comment fields their overlay consumes. */
export interface TextAnchor {
  readonly type: 'text';
  readonly quote: string;
  readonly prefix: string;
  readonly suffix: string;
}
export interface PageComment {
  readonly id: string;
  readonly body: string;
  readonly anchor: TextAnchor;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
/** Decodes the page-scoped list (`GET /api/page-comments/:token`). */
export function decodePageComments(value: unknown): readonly PageComment[] {
  const entries = record(value) && Array.isArray(value.comments) ? value.comments : [];
  return entries.flatMap((entry: unknown) => {
    if (!record(entry) || typeof entry.id !== 'string' || !entry.id
      || typeof entry.body !== 'string' || !record(entry.anchor)) return [];
    const anchor = entry.anchor;
    if (typeof anchor.quote !== 'string' || !anchor.quote) return [];
    return [{ id: entry.id, body: entry.body,
      anchor: { type: 'text' as const, quote: anchor.quote,
        prefix: typeof anchor.prefix === 'string' ? anchor.prefix : '',
        suffix: typeof anchor.suffix === 'string' ? anchor.suffix : '' } }];
  });
}
export function responseError(value: unknown, status: number): string {
  return record(value) && typeof value.error === 'string' && value.error ? value.error : `HTTP ${status}`;
}
