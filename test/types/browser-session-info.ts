import type { SessionStats, SessionShare, PublishedPage } from '../../src/browser/session-info-data';
import type { createSessionInfo } from '../../src/browser/session-info';
declare const stats: SessionStats;
declare const share: SessionShare;
declare const page: PublishedPage;
declare const controller: ReturnType<typeof createSessionInfo>;
// @ts-expect-error prices can be unavailable and cannot be assumed numeric
const total: number = stats.costs.total;
// @ts-expect-error page identity is read-only
page.token = 'other';
// @ts-expect-error share URLs retain their decoded snapshot
share.url = '/other';
// @ts-expect-error stats modal identity belongs to its controller
controller.statsOwner = null;
