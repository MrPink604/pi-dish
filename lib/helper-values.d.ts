// Generated from src/core/helper-values.ts; edit that source and run npm run build:core.
import type { Timestamp } from './helper-types';
export declare function record(value: unknown): value is Record<string, unknown>;
export declare function finite(value: unknown): value is number;
export declare function timestampMillis(value: Timestamp | null | undefined): number;
