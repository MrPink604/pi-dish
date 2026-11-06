// Generated from src/core/session-refs.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expandSessionRefs = expandSessionRefs;
/**
 * Resolve prompt #refs without treating peer hints as session authority.
 * Token-free prompts never consult the local catalog or fleet.
 */
const helper_refs_1 = require("./helper-refs");
const helper_values_1 = require("./helper-values");
/** Hints are untrusted metadata, clamped to the fields the context block uses. */
function sanitizeRefHint(hint) {
    if (!(0, helper_values_1.record)(hint) || typeof hint.ref !== 'string')
        return null;
    return {
        ref: hint.ref,
        name: typeof hint.name === 'string' ? hint.name : '',
        host: typeof hint.host === 'string' ? hint.host : '',
        cwd: typeof hint.cwd === 'string' ? hint.cwd : '',
        isActive: hint.isActive == null ? null : !!hint.isActive,
    };
}
function expandSessionRefs(message, hints, deps) {
    const text = typeof message === 'string' ? message : '';
    const tokens = (0, helper_refs_1.parseSessionRefTokens)(text);
    if (!tokens.length)
        return text;
    const byRef = new Map();
    for (const raw of Array.isArray(hints) ? hints : []) {
        const hint = sanitizeRefHint(raw);
        if (hint)
            byRef.set(hint.ref, hint);
    }
    let fleet = null;
    const entries = [];
    for (const { ref } of tokens) {
        const parts = (0, helper_refs_1.parseSessionRefParts)(ref);
        if (!parts)
            continue;
        const hint = byRef.get(ref) || null;
        const isLocal = !parts.hostPart
            || parts.hostPart.toLowerCase() === 'self'
            || parts.hostPart === deps.selfHostId;
        if (isLocal) {
            const session = deps.resolveLocal(parts.id, parts.hostIdForm);
            if (!session)
                continue;
            entries.push({
                ref,
                name: session.name || '',
                cwd: session.cwd || '',
                isActive: !!session.isActive,
            });
            continue;
        }
        if (!fleet) {
            fleet = new Set((deps.fleetNames() || []).map((name) => String(name || '').toLowerCase()));
        }
        if (!hint && !fleet.has(parts.hostPart.toLowerCase()))
            continue;
        entries.push({
            ref,
            name: hint ? hint.name : '',
            host: (hint && hint.host) || parts.hostPart,
            cwd: hint ? hint.cwd : '',
            isActive: hint ? hint.isActive : null,
        });
    }
    return (0, helper_refs_1.appendSessionRefContext)(text, entries);
}
