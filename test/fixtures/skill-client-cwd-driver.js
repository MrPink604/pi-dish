// Generated test/tool from test/fixtures/skill-client-cwd-driver.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function record(value) {
    return value !== null && (typeof value === 'object' || typeof value === 'function');
}
const loaded = require(process.argv[2]);
if (!record(loaded) || typeof loaded.discoverSession !== 'function') {
    throw new Error('Skill client fixture requires discoverSession');
}
try {
    Reflect.apply(loaded.discoverSession, loaded, []);
    process.exitCode = 2;
}
catch (error) {
    process.stdout.write(JSON.stringify({
        name: record(error) ? error.name : undefined,
        code: record(error) ? error.code : undefined,
    }));
}
