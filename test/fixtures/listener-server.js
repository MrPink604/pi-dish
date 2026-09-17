// Observe real startup, with controlled missing-interface and delayed-alias
// fixtures. Released listeners still bind real sockets.
const net = require('node:net');
const { errorMonitor } = require('node:events');
const listen = net.Server.prototype.listen;
let failedOnce = false;
let observedError;
net.Server.prototype.listen = function (...args) {
  if (process.env.PI_DISH_TEST_BIND_FAIL_ONCE && args[1] === process.env.HOST && !failedOnce) {
    failedOnce = true;
    process.nextTick(() => {
      this.emit('error', Object.assign(new Error('fixture interface unavailable'), { code: 'EADDRNOTAVAIL' }));
      process.send({ type: 'bind-failed' });
    });
    return this;
  }
  const start = () => {
    this.prependOnceListener(errorMonitor, error => {
      observedError = error;
      setImmediate(() => {
        process.send({ type: 'listen-error', host: args[1], code: error.code, advertised: process.env.PI_DISH_URL });
      });
    });
    const result = listen.apply(this, args);
    this.once('listening', () => setImmediate(() => {
      process.send({ type: 'listening', address: this.address(), advertised: process.env.PI_DISH_URL });
    }));
    return result;
  };
  const held = process.env.PI_DISH_TEST_HOLD_MAIN && args[1] === process.env.HOST && typeof args[0] === 'number' ? 'main'
    : process.env.PI_DISH_TEST_HOLD_ALIAS && args[1] === '127.0.0.1' ? 'alias' : null;
  if (held) {
    process.send({ type: `${held}-held` });
    const release = message => {
      if (!message[held === 'main' ? 'releaseMain' : 'releaseAlias']) return;
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
  const observer = type => ({
    ready(url) {
      process.send({ type, url, initialListening: initialServer.listening });
    },
    failed(error) {
      process.send({ type: 'startup-failed', message: error.message, code: error.code, nativeErrorIdentity: error === observedError });
    },
  });
  observeServerStartup(initialServer, observer('startup-ready'));
  process.on('message', message => {
    if (message.observeLate) observeServerStartup(initialServer, observer('late-ready'));
  });
}
