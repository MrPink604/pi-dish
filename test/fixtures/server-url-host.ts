export {};
const server: import('node:http').Server = require(process.argv[2]!);
function announce(): void {
  console.log(`PI_DISH_URL=${process.env.PI_DISH_URL || ''}`);
  setInterval(() => {}, 60000);
}
if (server.listening) announce();
else server.once('listening', announce);
