// Generated test/tool from test/fixtures/remote-server-host.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function record(value) {
    return value !== null && (typeof value === 'object' || typeof value === 'function');
}
function callable(value) {
    return typeof value === 'function';
}
const server = require(process.argv[2]);
if (!record(server))
    throw new Error('Remote server fixture requires an HTTP server');
const address = server.address;
const once = server.once;
if (!callable(address) || !callable(once)) {
    throw new Error('Remote server fixture requires an HTTP server');
}
const getAddress = () => address.call(server);
const onListening = (listener) => once.call(server, 'listening', listener);
function announce() {
    const value = getAddress();
    if (!record(value) || typeof value.port !== 'number')
        throw new Error('Remote server has no TCP address');
    console.log(`PI_DISH_PORT=${value.port}`);
}
if (server.listening === true)
    announce();
else
    onListening(announce);
