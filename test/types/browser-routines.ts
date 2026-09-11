import type { Routine, RoutineForm } from '../../src/browser/routines-data';
import type { createRoutinesView } from '../../src/browser/routines-view';
declare const routine: Routine;
declare const form: RoutineForm;
declare const view: ReturnType<typeof createRoutinesView>;
// @ts-expect-error routine endpoint snapshots cannot be retargeted
routine.endpoint.base = '/other';
// @ts-expect-error version history is read-only
routine.versions.push({ version: 2, prompt: 'text', savedAt: 0 });
// @ts-expect-error busy handling only supports harness wire choices
form.onBusy = 'interrupt';
// @ts-expect-error invocation ledger is owned by the view
view.invocations.push({ id: 'run' });
