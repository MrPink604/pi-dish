// Observe real startup, with controlled missing-interface and delayed-alias
// fixtures. Released listeners still bind real sockets.
import net = require('node:net');
import { errorMonitor, on } from 'node:events';
import fs = require('node:fs/promises');
import { syncBuiltinESMExports } from 'node:module';
import { record as isRecord } from '../../lib/helper-values.js';
const listen = net.Server.prototype.listen;
let failedOnce = false;
let observedError: Error | undefined;
const send = (message: Record<string, unknown>) => { process.send?.(message); };

if (process.env.PI_DISH_TEST_FAIL_PTY) {
  const dlopen = process.dlopen;
  process.dlopen = (module, filename, flags) => {
    if (filename.endsWith('/pty.node')) throw new Error('fixture PTY binary could not load');
    dlopen(module, filename, flags);
  };
}

const wasmMode = process.env.PI_DISH_TEST_WASM;
if (wasmMode) {
  const readFile = fs.readFile;
  fs.readFile = (async (...args: Parameters<typeof readFile>) => {
    if (!String(args[0]).endsWith('/quickjs.wasm')) return readFile(...args);
    if (wasmMode === 'corrupt') return Buffer.from('not a WASM module');
    send({ type: 'wasm-held' });
    for await (const [message] of on(process, 'message')) {
      if (isRecord(message) && message.releaseWasm) break;
    }
    return readFile(...args);
  }) as typeof fs.readFile;
  syncBuiltinESMExports();
}

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
    const observeError = (error: Error) => {
      observedError = error;
      setImmediate(() => {
        send({ type: 'listen-error', host: args[1], code: 'code' in error ? error.code : undefined, advertised: process.env.PI_DISH_URL });
      });
    };
    Reflect.apply(this.prependOnceListener, this, [errorMonitor, observeError]);
    const result: net.Server = Reflect.apply(listen, this, args);
    this.once('listening', () => setImmediate(() => {
      send({ type: 'listening', address: this.address(), advertised: process.env.PI_DISH_URL });
    }));
    return result;
  };
  const held = process.env.PI_DISH_TEST_HOLD_MAIN && args[1] === process.env.HOST && typeof args[0] === 'number' ? 'main'
    : process.env.PI_DISH_TEST_HOLD_ALIAS && args[1] === '127.0.0.1' ? 'alias' : null;
  if (held) {
    send({ type: `${held}-held` });
    const release = (message: unknown) => {
      if (!isRecord(message) || !message[held === 'main' ? 'releaseMain' : 'releaseAlias']) return;
      process.off('message', release);
      start();
    };
    process.on('message', release);
    return this;
  }
  return start();
};
const initialServer: import('node:http').Server = require('../../server');
if (process.env.PI_DISH_TEST_OBSERVE_STARTUP) {
  const { observeServerStartup }: typeof import('../../lib/server-app') = require('../../lib/server-app')
  const observer = (type: string) => ({
    ready(url: string) {
      send({ type, url, initialListening: initialServer.listening });
    },
    failed(error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const code = isRecord(error) ? error.code : undefined;
      send({ type: 'startup-failed', message, code, nativeErrorIdentity: error === observedError });
    },
  });
  observeServerStartup(initialServer, observer('startup-ready'));
  process.on('message', (message: unknown) => {
    if (isRecord(message) && message.observeLate) observeServerStartup(initialServer, observer('late-ready'));
  });
}

export {};
