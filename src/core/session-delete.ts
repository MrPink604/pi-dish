import fs = require('fs');
import path = require('path');
import { getHarness } from './harnesses';
import { sessionRootsFor } from './private-sessions';
import { invalidateSessionHeader } from './session-discovery';
import { httpError } from './http-boundary';
import type { SessionSource } from './session-source';

export interface SessionDeletePorts {
  findSessionSource(sessionId: string, options: { exact: boolean }): SessionSource | null;
  /** Live rows (bridge, RPC, Prime roster) with the transcript each one claims. */
  activeSessions(): readonly { readonly id: string; readonly sessionFile: string | null }[];
}

function realpath(file: string): string {
  try { return fs.realpathSync(file); } catch { return path.resolve(file); }
}
function within(directory: string, file: string): boolean {
  return file.startsWith(directory + path.sep);
}

/**
 * Permanently removes a closed session's JSONL and, for nested-subsession
 * harnesses (OMP), the sibling `<stem>/` subagent directory. The exact route
 * must resolve to a regular `.jsonl` inside one of the harness's own session
 * roots, and no live session may claim the file or anything in its subtree.
 */
export function createSessionDelete(ports: SessionDeletePorts) {
  return function deleteSession(sessionId: string): { deleted: string[] } {
    const source = ports.findSessionSource(sessionId, { exact: true });
    if (!source) throw httpError('Session not found', 404);
    const descriptor = getHarness(source.harnessId);
    if (!descriptor) throw httpError(`Unknown harness: ${source.harnessId}`, 400);
    const { file } = source;
    let stat: fs.Stats;
    try { stat = fs.lstatSync(file); } catch { throw httpError('Session not found', 404); }
    if (!stat.isFile() || !file.endsWith('.jsonl')) throw httpError('The session source is not a transcript file.', 400);
    const real = realpath(file);
    if (!sessionRootsFor(descriptor).some(({ root }) => within(realpath(root), real))) {
      throw httpError('The transcript is outside this harness\'s session folders.', 400);
    }
    const stem = file.slice(0, -'.jsonl'.length);
    let subtree: string | null = null;
    // lstat: a symlinked subagent directory is never followed or removed.
    if (descriptor.nestedSubsessions) { try { if (fs.lstatSync(stem).isDirectory()) subtree = stem; } catch {} }
    const realStem = realpath(stem);
    for (const active of ports.activeSessions()) {
      if (active.id === source.routeId) throw httpError('Close the session before deleting its transcript.', 409);
      if (!active.sessionFile) continue;
      const claimed = realpath(active.sessionFile);
      if (claimed === real || (subtree && within(realStem, claimed))) {
        throw httpError('A live session still uses this transcript; close it first.', 409);
      }
      // A live OMP parent may resume this subagent transcript.
      if (descriptor.nestedSubsessions && claimed.endsWith('.jsonl') && within(claimed.slice(0, -'.jsonl'.length), real)) {
        throw httpError('This subagent\'s parent session is live; close it first.', 409);
      }
    }
    fs.unlinkSync(file);
    invalidateSessionHeader(file);
    const deleted = [file];
    // Auxiliary files (agy's raw ACP sidecar) belong to this transcript only.
    for (const suffix of descriptor.auxiliaryJsonlSuffixes || []) {
      const sidecar = stem + suffix;
      try { if (fs.lstatSync(sidecar).isFile()) { fs.unlinkSync(sidecar); deleted.push(sidecar); } } catch {}
    }
    if (subtree) { fs.rmSync(subtree, { recursive: true }); deleted.push(subtree); }
    return { deleted };
  };
}
