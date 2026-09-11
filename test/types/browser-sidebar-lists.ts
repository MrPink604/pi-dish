import type { createSidebarQuery } from '../../src/browser/sidebar-query';
import type { createSidebarLists } from '../../src/browser/sidebar-lists';
declare const query: ReturnType<typeof createSidebarQuery>;
declare const lists: ReturnType<typeof createSidebarLists>;
// @ts-expect-error text changes need the owned query writer
query.query = 'foreign';
// @ts-expect-error scopes use immutable typed definitions
query.filters.push({ name: 'foreign', query: '' });
// @ts-expect-error request completion owns the server-query marker
lists.queriedFor = 'foreign';
// @ts-expect-error list request options explicitly require boolean historical scope
lists.load('', { withPrevious: 'yes' });
