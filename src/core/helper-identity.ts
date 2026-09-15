import type { HelperSession } from './helper-types';

/** The searchable metadata text of a session — one definition for local
 * filtering and the server-side session search. */
export function sessionMetaText(session: HelperSession) {
  return [session.name, session.cwd, session.model, session.id].join(' ').toLowerCase();
}
