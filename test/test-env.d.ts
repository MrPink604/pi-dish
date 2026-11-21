// Generated tool from test/test-env.ts; edit that source and run npm run build:tools.
declare function createTestTempDir(prefix: string): string;
declare function exitOnTestSignals(): void;
declare function shareOmpTestNatives(executable: string, home: string): string;
declare const fakeOmpModelsCommand: string;
declare function sanitizeTestEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
declare function applyTestEnv(): NodeJS.ProcessEnv;
export { sanitizeTestEnv, applyTestEnv, createTestTempDir, exitOnTestSignals, shareOmpTestNatives, fakeOmpModelsCommand };
