// Generated test/tool from test/fixtures/remote-server-host.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server = require(process.argv[2]);
function announce() {
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Remote server has no TCP address');
    console.log(`PI_DISH_PORT=${address.port}`);
}
if (server.listening)
    announce();
else
    server.once('listening', announce);
