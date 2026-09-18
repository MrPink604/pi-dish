// Generated test/tool from test/test-types.ts; edit that source and run npm run build:tests.
import type { BridgeRegistryEntry, HarnessId, NativeSessionId, SessionId } from '../lib/contracts.js';
export type TestRecord = Record<string, unknown>;
export declare function record(value: unknown, message?: string): TestRecord;
export declare function records(value: unknown, message?: string): TestRecord[];
export declare function strings(value: unknown, message?: string): string[];
export declare function present<T>(value: T | null | undefined, message?: string): T;
export declare function nativeId(value: unknown, message?: string): NativeSessionId;
export declare function routeId(value: unknown): SessionId;
export declare function harnessId(value: unknown, message?: string): HarnessId;
export declare function bridgeEntry<T extends TestRecord>(value: T, message?: string): T & BridgeRegistryEntry;
export declare function errorMessage(error: unknown): string;
