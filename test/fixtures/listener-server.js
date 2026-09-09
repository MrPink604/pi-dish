// Observe real startup, with controlled missing-interface and delayed-alias
// fixtures. Released listeners still bind real sockets.
const net = require('node:net');
const listen = net.Server.prototype.listen;
let failedOnce = false;
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
    this.once('error', error => setImmediate(() => {
      process.send({ type: 'listen-error', host: args[1], code: error.code, advertised: process.env.PI_DISH_URL });
    }));
    const result = listen.apply(this, args);
    this.once('listening', () => setImmediate(() => {
      process.send({ type: 'listening', address: this.address(), advertised: process.env.PI_DISH_URL });
    }));
    return result;
  };
  if (process.env.PI_DISH_TEST_HOLD_ALIAS && args[1] === '127.0.0.1') {
    process.send({ type: 'alias-held' });
    process.once('message', message => { if (message.releaseAlias) start(); });
    return this;
  }
  return start();
};
require('../../server');
