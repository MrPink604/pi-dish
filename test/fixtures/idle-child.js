// Generated test/tool from test/fixtures/idle-child.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
if (process.argv.includes('--ignore-sighup'))
    process.on('SIGHUP', () => { });
setInterval(() => { }, 1 << 30);
