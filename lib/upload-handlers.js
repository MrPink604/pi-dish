// Generated from src/core/upload-handlers.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_UPLOAD_MAX_MB = void 0;
exports.uploadMaxBytes = uploadMaxBytes;
exports.sessionUploadDir = sessionUploadDir;
exports.createUploadHandlers = createUploadHandlers;
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const node_stream_1 = require("node:stream");
const promises_1 = require("node:stream/promises");
const attachment_text_1 = require("./attachment-text");
const http_boundary_1 = require("./http-boundary");
const session_ownership_1 = require("./session-ownership");
const MB = 1024 * 1024;
exports.DEFAULT_UPLOAD_MAX_MB = 512;
// The listener has no whole-request deadline (a large video takes minutes on a
// phone uplink), so a stalled upload is ended by inactivity instead.
const UPLOAD_IDLE_TIMEOUT_MS = 60_000;
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/;
/** `PI_DISH_UPLOAD_MAX_MB` (default 512), in bytes. */
function uploadMaxBytes(env = process.env) {
    const mb = Number(env.PI_DISH_UPLOAD_MAX_MB);
    return Math.floor((Number.isFinite(mb) && mb > 0 ? mb : exports.DEFAULT_UPLOAD_MAX_MB) * MB);
}
/**
 * One directory per session route: `<harness>-<native id>` reduced to
 * `[A-Za-z0-9_-]`, so no route can name `.`/`..` or a separator. Null for an
 * invalid route.
 */
function sessionUploadDir(root, sessionId) {
    const identity = (0, session_ownership_1.routeIdentity)(sessionId);
    return identity ? path.join(root, `${identity.harnessId}-${identity.nativeSessionId.replace(/[^A-Za-z0-9_-]/g, '_')}`) : null;
}
class UploadTooLarge extends Error {
}
/**
 * Non-image composer attachments. The body streams straight to disk on the
 * session's host and the reply carries the prompt line naming the stored file;
 * images keep riding `/prompt` as content blocks.
 */
function createUploadHandlers(ports) {
    function tooLarge(res, maxBytes) {
        res.set('Connection', 'close');
        res.status(413).json({ error: `File exceeds this host's ${(0, attachment_text_1.formatByteSize)(maxBytes)} upload limit (PI_DISH_UPLOAD_MAX_MB).` });
    }
    const limits = (req, res) => {
        const directory = sessionUploadDir(ports.root(), req.params.id);
        if (!directory)
            return res.status(400).json({ error: 'Invalid session id' });
        res.json({ maxBytes: ports.maxBytes(), directory });
    };
    const upload = async (req, res) => {
        const sessionDirectory = sessionUploadDir(ports.root(), req.params.id);
        if (!sessionDirectory)
            return res.status(400).json({ error: 'Invalid session id' });
        // Any other type could be consumed by a body parser before this route.
        if (!req.is('application/octet-stream'))
            return res.status(415).json({ error: 'Send the file bytes as application/octet-stream' });
        const maxBytes = ports.maxBytes();
        if (Number(req.headers['content-length']) > maxBytes)
            return tooLarge(res, maxBytes);
        const originalName = typeof req.query.name === 'string' ? req.query.name : '';
        const name = (0, attachment_text_1.safeUploadName)(originalName);
        const type = typeof req.query.type === 'string' ? req.query.type.split(';')[0].trim().toLowerCase() : '';
        const mimeType = MIME_TYPE.test(type) ? type : 'application/octet-stream';
        // A fresh directory per upload keeps the original basename without collisions.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const directory = path.join(sessionDirectory, `${stamp}-${crypto.randomBytes(4).toString('hex')}`);
        const file = path.join(directory, name);
        const partial = path.join(directory, '.partial');
        let size = 0;
        const limiter = new node_stream_1.Transform({
            transform(chunk, _encoding, done) {
                size += chunk.length;
                done(size > maxBytes ? new UploadTooLarge() : null, chunk);
            },
        });
        req.setTimeout(UPLOAD_IDLE_TIMEOUT_MS, () => req.destroy(new Error('Upload stalled')));
        try {
            await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
            await (0, promises_1.pipeline)(req, limiter, fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
            await fs.promises.rename(partial, file);
        }
        catch (error) {
            await fs.promises.rm(directory, { recursive: true, force: true });
            if (req.socket.destroyed)
                return;
            if (error instanceof UploadTooLarge)
                return tooLarge(res, maxBytes);
            return res.status(500).json({ error: `Could not store the upload: ${(0, http_boundary_1.errorMessage)(error)}` });
        }
        finally {
            // The idle limit belongs to this request, not to the kept-alive socket.
            req.socket.setTimeout(0);
        }
        const stored = { path: file, name, originalName: originalName || name, mimeType, size };
        res.json({ ...stored, reference: (0, attachment_text_1.attachmentReference)(stored) });
    };
    /** Deleting a session's transcript also deletes the files uploaded to it. */
    function removeSession(sessionId) {
        const directory = sessionUploadDir(ports.root(), sessionId);
        if (directory)
            fs.rmSync(directory, { recursive: true, force: true });
    }
    return { limits, upload, removeSession };
}
