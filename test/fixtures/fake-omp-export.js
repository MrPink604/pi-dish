#!/usr/bin/env node
'use strict';

const fs = require('fs');

const args = process.argv.slice(2);
const exportIndex = args.indexOf('--export');
if (exportIndex >= 0) {
  const input = args[exportIndex + 1];
  const output = args[exportIndex + 2];
  if (!input || !output) process.exit(2);
  const records = fs.readFileSync(input, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse);
  if (records[0]?.type !== 'session') {
    process.stderr.write('session header must be first\n');
    process.exit(3);
  }
  const data = {
    header: records[0],
    entries: records.slice(1),
    leafId: records.at(-1)?.id || null,
    subSessionDirectoryPresent: fs.existsSync(input.slice(0, -'.jsonl'.length)),
  };
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64');
  fs.writeFileSync(output, `<!doctype html><html><head><title>Native OMP fixture export</title></head><body>
<script id="session-data">${encoded}</script><script>/* System Prompt; Available Tools */</script>
</body></html>`);
  process.exit(0);
}

if (args[0] === 'models' && args[1] === '--json') {
  process.stdout.write('[]\n');
  process.exit(0);
}

process.stderr.write(`unsupported fake OMP arguments: ${args.join(' ')}\n`);
process.exit(2);
