// Generated from src/core/cron.ts; edit that source and run npm run build:core.
/**
 * Hand-rolled five-field cron: no dependency so pi-dish runs on old-glibc Node
 * without native modules. Evaluated in local time (schedules are wall-clock),
 * hence Date's local getters rather than UTC arithmetic.
 */
type FieldName = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek';
export type ParsedCron = Record<FieldName, Set<number>> & {
    expression: string;
    domRestricted: boolean;
    dowRestricted: boolean;
};
/** Throws an Error whose message is safe to return as a 400. */
export declare function parseCron(expression: string): ParsedCron;
export declare function cronMatches(parsed: ParsedCron, when: Date): boolean;
/**
 * First matching minute strictly after `from`, or null if none within a year.
 * Skips by month/day/hour so a never-matching expression costs a few hundred iterations.
 */
export declare function nextCronMatch(parsed: ParsedCron, from?: Date): Date | null;
export {};
