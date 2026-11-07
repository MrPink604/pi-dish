import type * as Client from '../../skills/lib/pi-dish-client.js';

const client: typeof Client = require(process.argv[2]!);
try {
  client.discoverSession();
  process.exitCode = 2;
} catch (error: unknown) {
  const { name, code } = error as NodeJS.ErrnoException;
  process.stdout.write(JSON.stringify({ name, code }));
}
