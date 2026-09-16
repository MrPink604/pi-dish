/**
 * OMP's JSONL schema and standalone viewer are not Pi's. Export raw JSONL
 * through the configured OMP CLI, preserving native records and subsessions.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { getHarness, resolveLaunchSpec } from './harnesses';
import { isRecord } from './wire-protocol';

export interface OmpShareTool {
  name: string;
  description: string;
}

export interface OmpShareSnapshot {
  systemPrompt?: string;
  tools?: OmpShareTool[];
}

/** Native export fields remain opaque except for the validated entries array. */
export interface OmpExportData {
  [key: string]: unknown;
  entries: unknown[];
}

export interface OmpExportOptions {
  snapshot?: unknown;
}

const SESSION_DATA_RE = /(<script\b(?=[^>]*\bid=["']session-data["'])[^>]*>)([\s\S]*?)(<\/script>)/i;

function sessionDataMatch(html: string, policy: 'export' | 'import' = 'export'): { match: RegExpExecArray; data: OmpExportData } {
  const match = SESSION_DATA_RE.exec(html);
  if (!match) throw new Error('OMP export has no embedded session data');
  const encoded = match[2].trim();
  if (policy === 'export' && (!encoded || !/^[A-Za-z0-9+/=\s]+$/.test(encoded))) {
    throw new Error('OMP export has invalid embedded session data');
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch (error) {
    throw new Error(`Could not parse OMP export session data: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(data) || !Array.isArray(data.entries)) {
    throw new Error('OMP export embedded session data has an invalid shape');
  }
  return { match, data: data as OmpExportData };
}

/** Imports retain Buffer's permissive base64 decoding; exports enforce the alphabet. */
export function readOmpExportData(html: string, policy: 'export' | 'import' = 'export'): OmpExportData {
  return sessionDataMatch(html, policy).data;
}

export function normalizeSnapshot(snapshot: unknown): OmpShareSnapshot | null {
  if (!isRecord(snapshot)) return null;
  const systemPrompt = typeof snapshot.systemPrompt === 'string' ? snapshot.systemPrompt : undefined;
  const tools = Array.isArray(snapshot.tools)
    ? snapshot.tools
      .filter((tool: unknown): tool is OmpShareTool => !!tool
        && (typeof tool === 'object' || typeof tool === 'function')
        && 'name' in tool && typeof tool.name === 'string'
        && 'description' in tool && typeof tool.description === 'string')
      .map(tool => ({ name: tool.name, description: tool.description }))
    : undefined;
  if (systemPrompt === undefined && tools === undefined) return null;
  return { systemPrompt, tools };
}

export function injectOmpExportSnapshot(html: string, snapshot: unknown): string {
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) return html;
  const { match, data } = sessionDataMatch(html);
  if (normalized.systemPrompt !== undefined) data.systemPrompt = normalized.systemPrompt;
  if (normalized.tools !== undefined) data.tools = normalized.tools;
  const encoded = Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
  return html.slice(0, match.index) + match[1] + encoded + match[3]
    + html.slice(match.index + match[0].length);
}

function headerFirstSession(sessionPath: string): { sessionPath: string; tempDir: string | null } {
  const lines = fs.readFileSync(sessionPath, 'utf8').split('\n');
  const headerIndex = lines.findIndex((line) => {
    try {
      const entry: unknown = JSON.parse(line);
      return entry !== null && typeof entry === 'object' && 'type' in entry && entry.type === 'session';
    } catch { return false; }
  });
  if (headerIndex < 0) throw new Error('OMP session has no session header');
  if (headerIndex === 0) return { sessionPath, tempDir: null };

  // OMP's offline exporter requires the header first. Move (never drop) the
  // title/init preamble in a temporary view, leaving the original bytes intact.
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
    if (!isRecord(error) || error.code !== 'ENOENT') {
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw error;
    }
  }
  return { sessionPath: normalizedPath, tempDir };
}

export function exportOmpSessionHtml(sessionPath: string, outputPath: string, { snapshot }: OmpExportOptions = {}): Promise<string> {
  const descriptor = getHarness('omp');
  if (!descriptor?.argv.export) throw new Error('OMP HTML export is not supported');
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
        // Validate offline exports too: unrelated HTML is not a successful share.
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
