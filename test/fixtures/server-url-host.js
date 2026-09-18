// Generated test/tool from test/fixtures/server-url-host.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server = require(process.argv[2]);
function announce() {
    console.log(`PI_DISH_URL=${process.env.PI_DISH_URL || ''}`);
    setInterval(() => { }, 60000);
}
if (server.listening)
    announce();
else
    server.once('listening', announce);
