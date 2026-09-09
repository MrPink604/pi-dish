// Observe the real startup code. Only the retry scenario injects an error:
// emulate one absent interface, then let the production retry bind for real.
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
  const result = listen.apply(this, args);
  this.once('listening', () => setImmediate(() => {
    process.send({ type: 'listening', address: this.address(), advertised: process.env.PI_DISH_URL });
  }));
  return result;
};
require('../../server');
