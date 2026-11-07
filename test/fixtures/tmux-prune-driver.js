// Generated test/tool from test/fixtures/tmux-prune-driver.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
async function main() {
    const mode = process.argv[2];
    const tmux = require(process.argv[3]);
    if (mode === 'replacement') {
        tmux.recordSpawn('same', { socket: '/tmp/old.sock', paneId: '%1' });
        setTimeout(() => tmux.recordSpawn('same', { socket: '/tmp/new.sock', paneId: '%2' }), 50);
        await tmux.pruneSpawns();
        process.stdout.write(JSON.stringify(tmux.getSpawn('same')));
        return;
    }
    if (mode === 'stale') {
        tmux.recordSpawn('stale', { socket: '/tmp/fake.sock', paneId: '%9' });
        const exists = await tmux.paneExists('/tmp/fake.sock', '%9');
        await tmux.pruneSpawns();
        process.stdout.write(JSON.stringify({ exists, retained: !!tmux.getSpawn('stale') }));
        return;
    }
    throw new Error(`Unknown tmux prune fixture mode: ${mode}`);
}
void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
