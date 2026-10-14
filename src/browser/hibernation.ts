import type { HibernationState } from '../core/session-api';
import { formatRelativeTime } from './helper-format';

/** One sentence for the sidebar tooltip and the read-only session bar. */
export function hibernationSummary(state: HibernationState): string {
  const freed = `freed ~${(state.freedBytes / 1024 ** 3).toFixed(1)} GiB`;
  const discarded = state.discarded.length ? `; discarded ${state.discarded.join(', ')}` : '';
  return `Hibernated ${formatRelativeTime(state.hibernatedAt)} (${state.reason}; ${freed}${discarded}). Sending a message resumes it.`;
}
