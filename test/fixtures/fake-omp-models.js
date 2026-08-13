'use strict';

if (process.env.OMP_FIXTURE !== '1' || process.argv.slice(2).join(' ') !== 'models --json') {
  process.stderr.write('unexpected fake OMP invocation\n');
  process.exit(2);
}

process.stdout.write(JSON.stringify({ models: [
  {
    provider: 'zai',
    id: 'glm-4.7-flash',
    cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0.8 },
  },
] }));
