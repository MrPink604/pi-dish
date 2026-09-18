export {};
type HostRecord = Record<PropertyKey, unknown>;
function record(value: unknown): value is HostRecord {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

const loaded: unknown = require(process.argv[2]!);
if (!record(loaded) || typeof loaded.discoverSession !== 'function') {
  throw new Error('Skill client fixture requires discoverSession');
}
try {
  Reflect.apply(loaded.discoverSession, loaded, []);
  process.exitCode = 2;
} catch (error: unknown) {
  process.stdout.write(JSON.stringify({
    name: record(error) ? error.name : undefined,
    code: record(error) ? error.code : undefined,
  }));
}
