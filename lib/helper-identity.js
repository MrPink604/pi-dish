// Generated from src/core/helper-identity.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionMetaText = sessionMetaText;
/** The searchable metadata text of a session — one definition for local
 * filtering and the server-side session search. */
function sessionMetaText(session) {
    return [session.name, session.cwd, session.model, session.id].join(' ').toLowerCase();
}
