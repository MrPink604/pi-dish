// Generated from src/core/helper-media.ts; edit that source and run npm run build:core.
"use strict";
/** Portable media extension and MIME helpers shared by server and browser. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIDEO_MIME_BY_EXT = exports.IMAGE_MIME_BY_EXT = void 0;
exports.videoMimeForPath = videoMimeForPath;
exports.isVideoPath = isVideoPath;
exports.isVideoMimeType = isVideoMimeType;
exports.mediaFileName = mediaFileName;
exports.IMAGE_MIME_BY_EXT = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
};
exports.VIDEO_MIME_BY_EXT = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.ogv': 'video/ogg',
    '.mkv': 'video/x-matroska',
};
/** Strip query/fragment and `:line[:col]` suffixes before inspecting the extension. */
function cleanMediaPath(rawPath) {
    return String(rawPath || '').trim().split(/[?#]/)[0].replace(/:\d+(?::\d+)?$/, '');
}
/** Return the video MIME type for a path or URL with a supported video extension, else null. */
function videoMimeForPath(rawPath) {
    if (typeof rawPath !== 'string' || !rawPath)
        return null;
    const clean = cleanMediaPath(rawPath);
    const dot = clean.lastIndexOf('.');
    if (dot < 0)
        return null;
    const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
    if (dot <= slash + 1)
        return null;
    const ext = clean.slice(dot).toLowerCase();
    return Object.hasOwn(exports.VIDEO_MIME_BY_EXT, ext) ? exports.VIDEO_MIME_BY_EXT[ext] : null;
}
function isVideoPath(rawPath) {
    return videoMimeForPath(rawPath) !== null;
}
function isVideoMimeType(mimeType) {
    return typeof mimeType === 'string' && /^video\/[A-Za-z0-9.+-]+$/i.test(mimeType.trim());
}
function mediaFileName(rawPath, fallback = 'video') {
    if (typeof rawPath !== 'string' || !rawPath)
        return fallback;
    const clean = cleanMediaPath(rawPath).replace(/\/+$/, '');
    const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
    const base = slash >= 0 ? clean.slice(slash + 1) : clean;
    if (!base)
        return fallback;
    try {
        return decodeURIComponent(base);
    }
    catch {
        return base;
    }
}
