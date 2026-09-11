import type { createUsageView, UsageHost } from '../../src/browser/usage-view';
declare const controller: ReturnType<typeof createUsageView>;
declare const host: UsageHost;
// @ts-expect-error only supported range presets may trigger requests
controller.setRange('year');
// @ts-expect-error unsupported sort is rejected
controller.setSort('calls');
// @ts-expect-error result snapshots cannot have their range replaced
controller.data!.range = 'all';
// @ts-expect-error endpoint ownership is immutable
host.hostId = 'other';
// @ts-expect-error chart buckets cannot be appended
controller.chart!.buckets.push({ day: '2026-01-01' });
