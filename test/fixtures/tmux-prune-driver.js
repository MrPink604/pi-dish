// Generated test/tool from test/fixtures/tmux-prune-driver.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function record(value) {
    return value !== null && (typeof value === 'object' || typeof value === 'function');
}
function method(target, name) {
    const value = target[name];
    if (typeof value !== 'function')
        throw new Error(`tmux fixture requires ${name}`);
    return (...args) => Reflect.apply(value, target, args);
}
function call(target, name, ...args) {
    return Reflect.apply(method(target, name), target, args);
}
async function main() {
    const mode = process.argv[2];
    const loaded = require(process.argv[3]);
    if (!record(loaded))
        throw new Error('tmux fixture module is invalid');
    if (mode === 'replacement') {
        call(loaded, 'recordSpawn', 'same', { socket: '/tmp/old.sock', paneId: '%1' });
        setTimeout(() => call(loaded, 'recordSpawn', 'same', { socket: '/tmp/new.sock', paneId: '%2' }), 50);
        await call(loaded, 'pruneSpawns');
        process.stdout.write(JSON.stringify(call(loaded, 'getSpawn', 'same')));
        return;
    }
    if (mode === 'stale') {
        call(loaded, 'recordSpawn', 'stale', { socket: '/tmp/fake.sock', paneId: '%9' });
        const exists = await call(loaded, 'paneExists', '/tmp/fake.sock', '%9');
        await call(loaded, 'pruneSpawns');
        process.stdout.write(JSON.stringify({ exists, retained: !!call(loaded, 'getSpawn', 'stale') }));
        return;
    }
    throw new Error(`Unknown tmux prune fixture mode: ${mode}`);
}
void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
