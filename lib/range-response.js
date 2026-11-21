// Generated from src/core/range-response.ts; edit that source and run npm run build:core.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseByteRange = parseByteRange;
exports.sendRangedFile = sendRangedFile;
exports.sendRangedBuffer = sendRangedBuffer;
/**
 * RFC 9110 byte-range response helpers for local media files and in-memory
 * media buffers (206 Partial Content, 416 Range Not Satisfiable, Accept-Ranges,
 * HEAD, If-Range, and clean stream teardown on aborted seeks).
 */
const fs = __importStar(require("fs"));
/**
 * Parse a single `bytes=` Range header per RFC 9110 §14.1.2.
 * Returns `null` when absent, non-bytes, multi-range, or syntactically invalid
 * (callers serve 200 OK), `'unsatisfiable'` for valid out-of-bounds ranges
 * (callers serve 416), or `{ start, end }` inclusive bounds.
 */
function parseByteRange(rangeHeader, size) {
    const raw = Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader;
    if (typeof raw !== 'string')
        return null;
    const trimmed = raw.trim();
    const unitMatch = /^bytes=(.+)$/i.exec(trimmed);
    if (!unitMatch)
        return null;
    const spec = unitMatch[1].trim();
    // Multi-range requests are ignored (RFC 9110 allows serving full 200 OK).
    if (!spec || spec.includes(','))
        return null;
    const match = /^(\d*)-(\d*)$/.exec(spec);
    if (!match)
        return null;
    const [, startText, endText] = match;
    if (!startText && !endText)
        return null;
    if (size <= 0)
        return 'unsatisfiable';
    if (!startText) {
        // Suffix byte-range-spec: last N bytes.
        const suffix = Number(endText);
        if (!Number.isSafeInteger(suffix) || suffix <= 0)
            return 'unsatisfiable';
        const start = Math.max(0, size - suffix);
        return { start, end: size - 1 };
    }
    const start = Number(startText);
    if (!Number.isSafeInteger(start) || start < 0)
        return null;
    if (start >= size)
        return 'unsatisfiable';
    if (!endText) {
        return { start, end: size - 1 };
    }
    const requestedEnd = Number(endText);
    if (!Number.isSafeInteger(requestedEnd) || requestedEnd < 0)
        return null;
    if (requestedEnd < start)
        return 'unsatisfiable';
    return { start, end: Math.min(requestedEnd, size - 1) };
}
function makeEtag(size, mtimeMs) {
    return `"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`;
}
function ifRangeAllows(ifRangeHeader, etag, lastModifiedMs) {
    const raw = Array.isArray(ifRangeHeader) ? ifRangeHeader[0] : ifRangeHeader;
    if (typeof raw !== 'string' || !raw.trim())
        return true;
    const value = raw.trim();
    if (value.startsWith('"') || value.startsWith('W/')) {
        // RFC 9110 §13.1.5 requires strong comparison (weak ETags never match).
        return etag !== null && !value.startsWith('W/') && value === etag;
    }
    if (lastModifiedMs === null)
        return false;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed))
        return false;
    return Math.floor(parsed / 1000) === Math.floor(lastModifiedMs / 1000);
}
function sendRangedFile(req, res, absPath, options) {
    const { mimeType, size, mtimeMs, onError } = options;
    const etag = makeEtag(size, mtimeMs);
    const lastModified = new Date(mtimeMs).toUTCString();
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified);
    const rangeAllowed = ifRangeAllows(req.headers['if-range'], etag, mtimeMs);
    const parsed = rangeAllowed ? parseByteRange(req.headers.range, size) : null;
    if (parsed === 'unsatisfiable') {
        res.setHeader('Content-Range', `bytes */${size}`);
        res.setHeader('Content-Length', '0');
        res.status(416).end();
        return;
    }
    let start = 0;
    let end = size - 1;
    if (parsed) {
        start = parsed.start;
        end = parsed.end;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', String(end - start + 1));
    }
    else {
        res.status(200);
        res.setHeader('Content-Length', String(size));
    }
    if (req.method === 'HEAD' || size === 0) {
        res.end();
        return;
    }
    const stream = fs.createReadStream(absPath, parsed ? { start, end } : undefined);
    res.on('close', () => {
        if (!stream.destroyed)
            stream.destroy();
    });
    stream.on('error', (err) => {
        if (!stream.destroyed)
            stream.destroy();
        if (onError) {
            onError(err);
            return;
        }
        if (!res.headersSent) {
            res.status(404).type('text/plain').send('Not found');
        }
        else {
            res.destroy(err);
        }
    });
    stream.pipe(res);
}
function sendRangedBuffer(req, res, buffer, options) {
    const size = buffer.length;
    res.setHeader('Content-Type', options.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    const parsed = parseByteRange(req.headers.range, size);
    if (parsed === 'unsatisfiable') {
        res.setHeader('Content-Range', `bytes */${size}`);
        res.setHeader('Content-Length', '0');
        res.status(416).end();
        return;
    }
    if (parsed) {
        const slice = buffer.subarray(parsed.start, parsed.end + 1);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${parsed.start}-${parsed.end}/${size}`);
        res.setHeader('Content-Length', String(slice.length));
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        res.end(slice);
        return;
    }
    res.status(200);
    res.setHeader('Content-Length', String(size));
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    res.end(buffer);
}
