// Generated test/tool from test/fixtures/skill-client-cwd-driver.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client = require(process.argv[2]);
try {
    client.discoverSession();
    process.exitCode = 2;
}
catch (error) {
    const { name, code } = error;
    process.stdout.write(JSON.stringify({ name, code }));
}
