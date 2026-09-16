// Generated tool from test/test-env.ts; edit that source and run npm run build:tools.
declare const KEEP: Set<string>;
declare const DROP: string[];
/** A copy of `env` a test process can safely boot server.js from. */
declare function sanitizeTestEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
/** Same, applied to this process (for suites that boot the server in-process). */
declare function applyTestEnv(): NodeJS.ProcessEnv;
declare const TEST_ENV_FILE: string;
export { sanitizeTestEnv, applyTestEnv, KEEP, DROP, TEST_ENV_FILE };
