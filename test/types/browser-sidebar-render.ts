import type { SidebarRenderOptions } from '../../src/browser/sidebar-render';
declare const projection: SidebarRenderOptions;
import type { SessionEntry } from '../../src/browser/session-state';
declare const row: SessionEntry;
// @ts-expect-error render projections cannot mutate sidebar pin ownership
projection.pinned.push('foreign');
// @ts-expect-error render projections cannot expand persisted families
projection.expanded.add('foreign');
// @ts-expect-error metadata is established at ingress before rendering
row.contextPercent = {};

// The renderer accepts the established state shape without a second projection.
const rowFromState: SidebarRenderOptions['active'][number] = row;
const model: string | null | undefined = rowFromState.model;
void model;
// @ts-expect-error Renderers cannot reinterpret unknown extras as named metadata.
const extraModel: string = row.extras?.model;
void extraModel;
