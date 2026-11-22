import crypto = require('node:crypto');
import fs = require('node:fs');
import path = require('node:path');
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { attachmentReference, formatByteSize, safeUploadName } from './attachment-text';
import { errorMessage, type ApplicationResponse, type RouteHandler } from './http-boundary';
import { routeIdentity } from './session-ownership';

const MB = 1024 * 1024;
export const DEFAULT_UPLOAD_MAX_MB = 512;
// The listener has no whole-request deadline (a large video takes minutes on a
// phone uplink), so a stalled upload is ended by inactivity instead.
const UPLOAD_IDLE_TIMEOUT_MS = 60_000;
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/;

/** `PI_DISH_UPLOAD_MAX_MB` (default 512), in bytes. */
export function uploadMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const mb = Number(env.PI_DISH_UPLOAD_MAX_MB);
  return Math.floor((Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_UPLOAD_MAX_MB) * MB);
}

/**
 * One directory per session route: `<harness>-<native id>` reduced to
 * `[A-Za-z0-9_-]`, so no route can name `.`/`..` or a separator. Null for an
 * invalid route.
 */
export function sessionUploadDir(root: string, sessionId: string): string | null {
  const identity = routeIdentity(sessionId);
  return identity ? path.join(root, `${identity.harnessId}-${identity.nativeSessionId.replace(/[^A-Za-z0-9_-]/g, '_')}`) : null;
}

class UploadTooLarge extends Error {}

export interface UploadPorts {
  /** Parent of every session's upload directory (`~/.pi/dish/uploads`). */
  root(): string;
  maxBytes(): number;
}

/**
 * Non-image composer attachments. The body streams straight to disk on the
 * session's host and the reply carries the prompt line naming the stored file;
 * images keep riding `/prompt` as content blocks.
 */
export function createUploadHandlers(ports: UploadPorts): { limits: RouteHandler; upload: RouteHandler; removeSession(sessionId: string): void } {
  function tooLarge(res: ApplicationResponse, maxBytes: number) {
    res.set('Connection', 'close');
    res.status(413).json({ error: `File exceeds this host's ${formatByteSize(maxBytes)} upload limit (PI_DISH_UPLOAD_MAX_MB).` });
  }

  const limits: RouteHandler = (req, res) => {
    const directory = sessionUploadDir(ports.root(), req.params.id);
    if (!directory) return res.status(400).json({ error: 'Invalid session id' });
    res.json({ maxBytes: ports.maxBytes(), directory });
  };

  const upload: RouteHandler = async (req, res) => {
    const sessionDirectory = sessionUploadDir(ports.root(), req.params.id);
    if (!sessionDirectory) return res.status(400).json({ error: 'Invalid session id' });
    // Any other type could be consumed by a body parser before this route.
    if (!req.is('application/octet-stream')) return res.status(415).json({ error: 'Send the file bytes as application/octet-stream' });
    const maxBytes = ports.maxBytes();
    if (Number(req.headers['content-length']) > maxBytes) return tooLarge(res, maxBytes);
    const originalName = typeof req.query.name === 'string' ? req.query.name : '';
    const name = safeUploadName(originalName);
    const type = typeof req.query.type === 'string' ? req.query.type.split(';')[0].trim().toLowerCase() : '';
    const mimeType = MIME_TYPE.test(type) ? type : 'application/octet-stream';
    // A fresh directory per upload keeps the original basename without collisions.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const directory = path.join(sessionDirectory, `${stamp}-${crypto.randomBytes(4).toString('hex')}`);
    const file = path.join(directory, name);
    const partial = path.join(directory, '.partial');
    let size = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        done(size > maxBytes ? new UploadTooLarge() : null, chunk);
      },
    });
    req.setTimeout(UPLOAD_IDLE_TIMEOUT_MS, () => req.destroy(new Error('Upload stalled')));
    try {
      await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
      await pipeline(req, limiter, fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
      await fs.promises.rename(partial, file);
    } catch (error) {
      await fs.promises.rm(directory, { recursive: true, force: true });
      if (req.socket.destroyed) return;
      if (error instanceof UploadTooLarge) return tooLarge(res, maxBytes);
      return res.status(500).json({ error: `Could not store the upload: ${errorMessage(error)}` });
    } finally {
      // The idle limit belongs to this request, not to the kept-alive socket.
      req.socket.setTimeout(0);
    }
    const stored = { path: file, name, originalName: originalName || name, mimeType, size };
    res.json({ ...stored, reference: attachmentReference(stored) });
  };

  /** Deleting a session's transcript also deletes the files uploaded to it. */
  function removeSession(sessionId: string) {
    const directory = sessionUploadDir(ports.root(), sessionId);
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }

  return { limits, upload, removeSession };
}
