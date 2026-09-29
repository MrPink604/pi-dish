// Generated test/tool from test/fixtures/pi-tree-read.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pi_sdk_js_1 = require("../../lib/pi-sdk.js");
// A corrupt ancestry must not be able to hang the parent regression runner.
void (0, pi_sdk_js_1.getSessionTree)(process.argv[2]).then(tree => {
    process.stdout.write(JSON.stringify(tree));
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
