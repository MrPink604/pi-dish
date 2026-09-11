import type { SidebarRenderOptions, SidebarSession } from '../../src/browser/sidebar-render';
declare const projection: SidebarRenderOptions;
declare const row: SidebarSession;
// @ts-expect-error render projections cannot mutate sidebar pin ownership
projection.pinned.push('foreign');
// @ts-expect-error render projections cannot expand persisted families
projection.expanded.add('foreign');
// @ts-expect-error metadata is narrowed before arithmetic/rendering
row.contextPercent = {};
