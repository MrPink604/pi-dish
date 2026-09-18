export {};
type HostRecord = Record<PropertyKey, unknown>;
function record(value: unknown): value is HostRecord {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}
function callable(value: unknown): value is (this: unknown, ...args: unknown[]) => unknown {
  return typeof value === 'function';
}

const server: unknown = require(process.argv[2]!);
if (!record(server)) throw new Error('Remote server fixture requires an HTTP server');
const address = server.address;
const once = server.once;
if (!callable(address) || !callable(once)) {
  throw new Error('Remote server fixture requires an HTTP server');
}
const getAddress = (): unknown => address.call(server);
const onListening = (listener: () => void): unknown => once.call(server, 'listening', listener);
function announce(): void {
  const value = getAddress();
  if (!record(value) || typeof value.port !== 'number') throw new Error('Remote server has no TCP address');
  console.log(`PI_DISH_PORT=${value.port}`);
}
if (server.listening === true) announce();
else onListening(announce);
