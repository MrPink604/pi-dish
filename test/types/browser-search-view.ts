import type { SearchPayload } from '../../src/browser/search-data';
import type { createSearchView } from '../../src/browser/search-view';
declare const data: SearchPayload;
declare const controller: ReturnType<typeof createSearchView>;
// @ts-expect-error wire results cannot be appended by consumers
data.results.push({ id: 'other' });
// @ts-expect-error facet rewrites accept only the shared grammar fields
controller.setToken('arbitrary-regexp', 'value');
// @ts-expect-error query text is a string
controller.open({ query: 'value' });
