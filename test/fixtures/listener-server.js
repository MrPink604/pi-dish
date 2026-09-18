// Generated test/tool from test/fixtures/listener-server.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Observe real startup, with controlled missing-interface and delayed-alias
// fixtures. Released listeners still bind real sockets.
const net = require("node:net");
const node_events_1 = require("node:events");
const wire_protocol_js_1 = require("../../lib/wire-protocol.js");
const listen = net.Server.prototype.listen;
let failedOnce = false;
let observedError;
const send = (message) => { process.send?.(message); };
net.Server.prototype.listen = function (...args) {
    if (process.env.PI_DISH_TEST_BIND_FAIL_ONCE && args[1] === process.env.HOST && !failedOnce) {
        failedOnce = true;
        process.nextTick(() => {
            this.emit('error', Object.assign(new Error('fixture interface unavailable'), { code: 'EADDRNOTAVAIL' }));
            send({ type: 'bind-failed' });
        });
        return this;
    }
    const start = () => {
        const observeError = (error) => {
            observedError = error;
            setImmediate(() => {
                send({ type: 'listen-error', host: args[1], code: 'code' in error ? error.code : undefined, advertised: process.env.PI_DISH_URL });
            });
        };
        Reflect.apply(this.prependOnceListener, this, [node_events_1.errorMonitor, observeError]);
        const result = Reflect.apply(listen, this, args);
        this.once('listening', () => setImmediate(() => {
            send({ type: 'listening', address: this.address(), advertised: process.env.PI_DISH_URL });
        }));
        return result;
    };
    const held = process.env.PI_DISH_TEST_HOLD_MAIN && args[1] === process.env.HOST && typeof args[0] === 'number' ? 'main'
        : process.env.PI_DISH_TEST_HOLD_ALIAS && args[1] === '127.0.0.1' ? 'alias' : null;
    if (held) {
        send({ type: `${held}-held` });
        const release = (message) => {
            if (!(0, wire_protocol_js_1.isRecord)(message) || !message[held === 'main' ? 'releaseMain' : 'releaseAlias'])
                return;
            process.off('message', release);
            start();
        };
        process.on('message', release);
        return this;
    }
    return start();
};
const initialServer = require('../../server');
if (process.env.PI_DISH_TEST_OBSERVE_STARTUP) {
    const { observeServerStartup } = require('../../lib/server-app');
    const observer = (type) => ({
        ready(url) {
            send({ type, url, initialListening: initialServer.listening });
        },
        failed(error) {
            const message = error instanceof Error ? error.message : String(error);
            const code = (0, wire_protocol_js_1.isRecord)(error) ? error.code : undefined;
            send({ type: 'startup-failed', message, code, nativeErrorIdentity: error === observedError });
        },
    });
    observeServerStartup(initialServer, observer('startup-ready'));
    process.on('message', (message) => {
        if ((0, wire_protocol_js_1.isRecord)(message) && message.observeLate)
            observeServerStartup(initialServer, observer('late-ready'));
    });
}
