import { groupByWorkspace, buildWorkspaceTree, buildSessionFamilies, flattenSessionFamilies,
  resolveSessionRefAmong, extractImageBlocks, extractTextContent, thinkingLevelsFor } from '../../src/browser/shared-helpers';
const sessions = [{ id: 'id', cwd: '/cwd', lastActivity: '2026-09-11', extra: 'retained' }];
const grouped = groupByWorkspace(sessions);
const extra: string = grouped[0][1][0].extra;
const treeExtra: string | undefined = buildWorkspaceTree(grouped)[0].sessions?.[0].extra;
const familyExtra: string = flattenSessionFamilies(buildSessionFamilies(sessions))[0].extra;
const refExtra: string | undefined = resolveSessionRefAmong(sessions, 'id').session?.extra;
const text: string = extractTextContent(null);
const levels: readonly string[] = thinkingLevelsFor('omp', { thinking: ['high'] });
// @ts-expect-error unknown wire blocks do not become arbitrary mutable objects
extractImageBlocks(null)[0].url = 7;
// @ts-expect-error grouping preserves the concrete row type
const wrong: number = grouped[0][1][0].extra;
void [extra, treeExtra, familyExtra, refExtra, text, levels, wrong];
