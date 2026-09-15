import { groupByWorkspace, buildWorkspaceTree, buildSessionFamilies, flattenSessionFamilies } from '../../src/browser/helper-sessions';
import { resolveSessionRefAmong, searchSessionsForRef, formatSessionRefContext } from '../../src/core/helper-refs';
import { applyLocalFilter } from '../../src/core/helper-query';
import type { RefContextEntry } from '../../src/core/helper-types';
import { extractImageBlocks, extractTextContent } from '../../src/core/helper-content';
import { thinkingLevelsFor } from '../../src/core/helper-models';
const sessions = [{ id: 'id', cwd: '/cwd', lastActivity: '2026-09-11', extra: 'retained' }] as const;
const grouped = groupByWorkspace(sessions);
const extra: string = grouped[0][1][0].extra;
const treeExtra: string | undefined = buildWorkspaceTree(grouped)[0].sessions?.[0].extra;
const familyExtra: string = flattenSessionFamilies(buildSessionFamilies(sessions))[0].extra;
const refExtra: string | undefined = resolveSessionRefAmong(sessions, 'id').session?.extra;
const filtered = applyLocalFilter(sessions, 'cwd:/cwd');
const searched = searchSessionsForRef(sessions, 'id');
const entries: readonly RefContextEntry[] = [{ ref: 'id', cwd: '/cwd' }];
const refContext: string = formatSessionRefContext(entries);
// @ts-expect-error filtering preserves readonly row fields
filtered[0].extra = 'changed';
// @ts-expect-error reference resolution preserves readonly row fields
resolveSessionRefAmong(sessions, 'id').session!.extra = 'changed';
// @ts-expect-error reference search preserves readonly row fields
searched[0].session.extra = 'changed';
const text: string = extractTextContent(null);
const levels: readonly string[] = thinkingLevelsFor('omp', { thinking: ['high'] });
// @ts-expect-error unknown wire blocks do not become arbitrary mutable objects
extractImageBlocks(null)[0].url = 7;
// @ts-expect-error grouping preserves the concrete row type
const wrong: number = grouped[0][1][0].extra;
void [extra, treeExtra, familyExtra, refExtra, refContext, text, levels, wrong];
