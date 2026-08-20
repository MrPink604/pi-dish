const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  exportOmpSessionHtml,
  injectOmpExportSnapshot,
  readOmpExportData,
} = require('../lib/omp-export');

const fakeExporter = path.join(__dirname, 'fixtures', 'fake-omp-export.js');

test('OMP export uses its native renderer, preserves the pre-header, and injects a live snapshot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-export-test-'));
  const sessionFile = path.join(root, 'session.jsonl');
  const outputFile = path.join(root, 'session.html');
  const source = [
    { type: 'title', title: 'OMP title record' },
    { type: 'session_init', task: 'root task' },
    { type: 'session', version: 3, id: 'omp-export-test', cwd: root },
    { type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: 'hello' } },
  ].map(JSON.stringify).join('\n') + '\n';
  fs.writeFileSync(sessionFile, source);
  const subSessions = sessionFile.slice(0, -'.jsonl'.length);
  fs.mkdirSync(subSessions);
  fs.writeFileSync(path.join(subSessions, 'worker.jsonl'), JSON.stringify({ type: 'session', id: 'worker' }));
  const previous = process.env.PI_DISH_OMP_COMMAND;
  process.env.PI_DISH_OMP_COMMAND = `${process.execPath} ${fakeExporter}`;
  try {
    const result = await exportOmpSessionHtml(sessionFile, outputFile, {
      snapshot: {
        systemPrompt: 'effective system prompt',
        tools: [{ name: 'read', description: 'Read a file', parameters: { type: 'object' } }],
      },
    });
    assert.equal(result, outputFile);
    const html = fs.readFileSync(outputFile, 'utf8');
    assert.ok(html.includes('Native OMP fixture export'));
    const data = readOmpExportData(html);
    assert.equal(data.header.id, 'omp-export-test');
    assert.deepEqual(data.entries.map(entry => entry.type), ['title', 'session_init', 'message']);
    assert.equal(data.systemPrompt, 'effective system prompt');
    assert.deepEqual(data.tools, [{ name: 'read', description: 'Read a file' }]);
    assert.equal(data.subSessionDirectoryPresent, true, 'OMP can still discover native subsessions');
    assert.equal(fs.readFileSync(sessionFile, 'utf8'), source, 'the source JSONL stays byte-for-byte intact');
  } finally {
    if (previous === undefined) delete process.env.PI_DISH_OMP_COMMAND;
    else process.env.PI_DISH_OMP_COMMAND = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OMP export data injection rejects malformed native HTML', () => {
  assert.throws(() => injectOmpExportSnapshot('<html></html>', { systemPrompt: 'x' }), /no embedded session data/);
  const malformed = '<html><script id="session-data">bm90LWpzb24=</script></html>';
  assert.throws(() => injectOmpExportSnapshot(malformed, { systemPrompt: 'x' }), /Could not parse/);
});

test('OMP exporter command failures are reported', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-export-fail-'));
  const sessionFile = path.join(root, 'session.jsonl');
  fs.writeFileSync(sessionFile, JSON.stringify({ type: 'session', id: 'failure-test' }) + '\n');
  const previous = process.env.PI_DISH_OMP_COMMAND;
  process.env.PI_DISH_OMP_COMMAND = path.join(root, 'missing-omp');
  try {
    await assert.rejects(exportOmpSessionHtml(sessionFile, path.join(root, 'out.html')), /ENOENT/);
  } finally {
    if (previous === undefined) delete process.env.PI_DISH_OMP_COMMAND;
    else process.env.PI_DISH_OMP_COMMAND = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
