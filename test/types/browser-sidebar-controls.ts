import type { createSidebarControls } from '../../src/browser/sidebar-controls';
import type { SessionState } from '../../src/browser/session-state';
declare const controls: ReturnType<typeof createSidebarControls>;
declare const state: SessionState;
// @ts-expect-error pin order is controller-owned
controls.pinned = ['changed'];
// @ts-expect-error expansion uses an explicit state writer
controls.expanded.add('changed');
// @ts-expect-error a caller cannot retarget the selection generation
state.selectionGeneration = 100;
// @ts-expect-error close actions require an owning host id, never arbitrary metadata
controls.performClose('id', { host: 'peer' });
