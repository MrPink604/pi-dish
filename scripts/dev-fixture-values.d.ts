// Generated test/tool from scripts/dev-fixture-values.ts; edit that source and run npm run build:tests.
export type FixtureRecord = Record<string, unknown>;
export declare function record(value: unknown): FixtureRecord;
export declare function records(value: unknown): FixtureRecord[];
export declare function present<T>(value: T | null | undefined): T;
export declare function checkedNativeId(value: unknown): import("../lib/contracts").NativeSessionId;
