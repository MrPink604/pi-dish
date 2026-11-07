import type { Server } from 'node:http';

const server: Server = require(process.argv[2]!);
function announce(): void {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Remote server has no TCP address');
  console.log(`PI_DISH_PORT=${address.port}`);
}
if (server.listening) announce();
else server.once('listening', announce);
