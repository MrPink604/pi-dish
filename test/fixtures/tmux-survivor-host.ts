import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

const marker = process.argv[2];
if (!marker) throw new Error('tmux survivor fixture requires a marker path');
const idle = path.join(__dirname, 'idle-child.js');
const child = spawn(process.execPath, [idle, '--ignore-sighup'], { detached: true, stdio: 'ignore' });
if (!child.pid) throw new Error('tmux survivor fixture failed to spawn its descendant');
fs.writeFileSync(marker, String(child.pid));
child.unref();
setInterval(() => {}, 1 << 30);
