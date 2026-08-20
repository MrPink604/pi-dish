/**
 * Oh My Pi HTML export support.
 *
 * OMP's JSONL is Pi-lineage, but its entry schema and standalone viewer are
 * not Pi's. Always ask the configured OMP CLI to export the file, then (for a
 * live bridged session) add the runtime-only prompt/tool snapshot that OMP
 * does not persist in the root JSONL.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { getHarness, resolveLaunchSpec } = require('./harnesses');

const SESSION_DATA_RE = /(<script\b(?=[^>]*\bid=["']session-data["'])[^>]*>)([\s\S]*?)(<\/script>)/i;

function sessionDataMatch(html) {
  const match = SESSION_DATA_RE.exec(html);
  if (!match) throw new Error('OMP export has no embedded session data');
  const encoded = match[2].trim();
  if (!encoded || !/^[A-Za-z0-9+/=\s]+$/.test(encoded)) {
    throw new Error('OMP export has invalid embedded session data');
  }
  let data;
  try {
    data = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch (error) {
    throw new Error(`Could not parse OMP export session data: ${error.message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.entries)) {
    throw new Error('OMP export embedded session data has an invalid shape');
  }
  return { match, data };
}

function readOmpExportData(html) {
  return sessionDataMatch(html).data;
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const systemPrompt = typeof snapshot.systemPrompt === 'string' ? snapshot.systemPrompt : undefined;
  const tools = Array.isArray(snapshot.tools)
    ? snapshot.tools
      .filter(tool => tool && typeof tool.name === 'string' && typeof tool.description === 'string')
      .map(tool => ({ name: tool.name, description: tool.description }))
    : undefined;
  if (systemPrompt === undefined && tools === undefined) return null;
  return { systemPrompt, tools };
}

function injectOmpExportSnapshot(html, snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) return html;
  const { match, data } = sessionDataMatch(html);
  if (normalized.systemPrompt !== undefined) data.systemPrompt = normalized.systemPrompt;
  if (normalized.tools !== undefined) data.tools = normalized.tools;
  const encoded = Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
  return html.slice(0, match.index) + match[1] + encoded + match[3]
    + html.slice(match.index + match[0].length);
}

function headerFirstSession(sessionPath) {
  const lines = fs.readFileSync(sessionPath, 'utf8').split('\n');
  const headerIndex = lines.findIndex((line) => {
    try { return JSON.parse(line).type === 'session'; } catch { return false; }
  });
  if (headerIndex < 0) throw new Error('OMP session has no session header');
  if (headerIndex === 0) return { sessionPath, tempDir: null };

  // OMP normally keeps a title/init preamble before Pi's v3 session header,
  // while its own offline exporter currently requires that header first.
  // Move (rather than drop) the preamble in a temporary view so OMP-specific
  // records still reach OMP's native renderer and the source JSONL is intact.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-export-'));
  const normalizedPath = path.join(tempDir, path.basename(sessionPath));
  const normalized = [lines[headerIndex], ...lines.slice(0, headerIndex), ...lines.slice(headerIndex + 1)];
  fs.writeFileSync(normalizedPath, normalized.join('\n'));
  const subSessions = sessionPath.slice(0, -'.jsonl'.length);
  try {
    if (fs.statSync(subSessions).isDirectory()) {
      fs.symlinkSync(
        subSessions,
        normalizedPath.slice(0, -'.jsonl'.length),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw error;
    }
  }
  return { sessionPath: normalizedPath, tempDir };
}

function exportOmpSessionHtml(sessionPath, outputPath, { snapshot } = {}) {
  const descriptor = getHarness('omp');
  const spec = resolveLaunchSpec(descriptor);
  let normalized;
  try {
    normalized = headerFirstSession(sessionPath);
  } catch (error) {
    return Promise.reject(error);
  }
  const commandArgs = descriptor.argv.export({ file: normalized.sessionPath, output: outputPath });
  const args = [...spec.argv.slice(1), ...commandArgs];
  return new Promise((resolve, reject) => {
    execFile(spec.argv[0], args, {
      env: { ...process.env, ...spec.env },
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, _stdout, stderr) => {
      try {
        if (error) throw new Error((stderr || error.message).trim());
        if (!fs.existsSync(outputPath)) throw new Error('OMP exporter did not create an HTML file');
        const html = fs.readFileSync(outputPath, 'utf8');
        // Validate even an offline export so a CLI invocation that silently
        // produced some other HTML cannot be published as a successful share.
        sessionDataMatch(html);
        if (snapshot) fs.writeFileSync(outputPath, injectOmpExportSnapshot(html, snapshot));
        resolve(outputPath);
      } catch (exportError) {
        reject(exportError);
      } finally {
        if (normalized.tempDir) fs.rmSync(normalized.tempDir, { recursive: true, force: true });
      }
    });
  });
}

module.exports = {
  exportOmpSessionHtml,
  injectOmpExportSnapshot,
  normalizeSnapshot,
  readOmpExportData,
};
