#!/usr/bin/env node
// Every scenario starts a new process, HOME, server and browser context.
import { spawn, type ChildProcess } from 'node:child_process';
import path = require('node:path');
import scenarios = require('../test/ui-scenarios/index.js');
let child: ChildProcess | undefined;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { interrupted = true; child?.kill(signal); });
(async () => {
  let failed = false;
  for (const name of Object.keys(scenarios)) {
    if (interrupted) break;
    console.log(`\n=== Independent scenario: ${name} ===`);
    const code = await new Promise<number | null>((resolve, reject) => {
      child = spawn(process.execPath, [path.join(__dirname, '../test/ui-smoke.js'), '--scenario', name], { stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(signal ? 1 : code));
    });
    if (code !== 0) failed = true;
  }
  process.exitCode = failed || interrupted ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
