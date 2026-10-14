#!/usr/bin/env node
'use strict';

import fs = require('node:fs');
import { record } from '../test-types.js';

const args = process.argv.slice(2);
const exportIndex = args.indexOf('--export');
if (exportIndex >= 0) {
  const input = args[exportIndex + 1];
  const output = args[exportIndex + 2];
  if (!input || !output) process.exit(2);
  const records: unknown[] = fs.readFileSync(input, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line): unknown => JSON.parse(line));
  const header = record(records[0]);
  if (header.type !== 'session') {
    process.stderr.write('session header must be first\n');
    process.exit(3);
  }
  const data = {
    header,
    entries: records.slice(1),
    leafId: records.length ? record(records.at(-1)).id || null : null,
    subSessionDirectoryPresent: fs.existsSync(input.slice(0, -'.jsonl'.length)),
  };
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64');
  fs.writeFileSync(output, `<!doctype html><html><head><title>Native OMP fixture export</title></head><body>
<script id="session-data">${encoded}</script><script>/* System Prompt; Available Tools */</script>
</body></html>`);
  process.exit(0);
}

// `omp usage --json --redact`: one provider report with raw account metadata
// the server must strip, one malformed limit it must drop, and reset credits
// whose used grant and upstream ids must not reach the wire.
if (args[0] === 'usage' && args.includes('--json')) {
  process.stdout.write(JSON.stringify({
    generatedAt: 1700000000000,
    reports: [{
      provider: 'fakeprov',
      fetchedAt: 1700000001000,
      metadata: { planType: 'pro', email: 'secret@example.com', accountId: 'acct-123' },
      limits: [
        { id: 'fakeprov:primary', label: '7 days', scope: { accountId: 'acct-123' },
          window: { id: '7d', label: '7 days', resetsAt: 1700604800000 },
          amount: { usedFraction: 0.42, remainingFraction: 0.58, unit: 'percent' }, status: 'ok' },
        { id: 'broken', label: null, amount: { usedFraction: 'x' } },
      ],
      resetCredits: {
        availableCount: 1,
        credits: [
          { id: 'promo-secret-id', program: 'internal', title: 'Launch reset', remainingCount: 2,
            grantedAt: '2023-11-01T00:00:00.000Z', expiresAt: '2023-12-01T00:00:00.000Z', status: 'available' },
          { id: 'spent', title: 'Old reset', expiresAt: '2023-12-02T00:00:00.000Z', status: 'used' },
        ],
      },
    }, { provider: 'nolimits', limits: [] }],
  }) + '\n');
  process.exit(0);
}

if (args[0] === 'models' && args[1] === '--json') {
  process.stdout.write('[]\n');
  process.exit(0);
}

process.stderr.write(`unsupported fake OMP arguments: ${args.join(' ')}\n`);
process.exit(2);

export {};
