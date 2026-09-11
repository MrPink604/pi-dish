import type { RecoveryHost, RecoveryReport, createRecovery } from '../../src/browser/recovery';
declare const host: RecoveryHost;
declare const report: RecoveryReport;
declare const controller: ReturnType<typeof createRecovery>;
// @ts-expect-error host identities cannot be retargeted by consumers
host.hostId = 'other';
// @ts-expect-error narrowed report rows remain readonly
report.sessions.push({ id: 'other' });
// @ts-expect-error opening a report requires an actual host id
controller.open({ hostId: 'other' });
