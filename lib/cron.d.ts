// Generated from src/core/cron.ts; edit that source and run npm run build:core.
/**
 * A five-field cron parser/matcher, hand-rolled.
 *
 * No dependency on purpose: pi-dish must run on a hand-built Node on an old
 * glibc (no native modules), and the whole feature needs exactly three things
 * from cron — "is this minute a match", "when is the next one", and a parse
 * error message good enough to hand back as a 400.
 *
 * Everything is evaluated in **local time** (the user's schedules read as
 * wall-clock times), which is why matching and the next-match walk both go
 * through Date's local getters rather than UTC arithmetic.
 */
export declare const ALIASES: Record<string, string>;
type FieldName = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek';
export type ParsedCron = Record<FieldName, Set<number>> & {
    expression: string;
    domRestricted: boolean;
    dowRestricted: boolean;
};
/**
 * Parse a 5-field cron expression (or one of the `@` aliases).
 * Throws an Error whose message is safe to hand back as a 400.
 */
export declare function parseCron(expression: unknown): ParsedCron;
export declare function cronMatches(parsed: ParsedCron, date: Date | string | number): boolean;
/**
 * The first minute strictly after `fromDate` that matches, or null when the
 * expression cannot fire within a year (`0 0 30 2 *`, say). The walk skips by
 * month/day/hour rather than minute so a never-matching expression costs a few
 * hundred iterations, not half a million.
 */
export declare function nextCronMatch(parsed: ParsedCron, fromDate?: Date | string | number): Date | null;
/** Convenience for callers that only hold the raw string. */
export declare function describeCron(expression: unknown): string | null;
export {};
