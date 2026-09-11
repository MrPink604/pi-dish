import type { SessionRelation } from '../../src/browser/session-relations';
import type { createSessionSearch } from '../../src/browser/session-search';
declare const relation: SessionRelation;
declare const search: ReturnType<typeof createSessionSearch>;
// @ts-expect-error a rendered relation retains its target identity
relation.session.id = 'other';
// @ts-expect-error query state changes through owned requests
search.state.query = 'other';
// @ts-expect-error search match arrays cannot be externally replaced
search.state.matches.push({ index: 0, role: 'user' });
// @ts-expect-error paging position belongs to controller navigation
search.state.pos = 4;
