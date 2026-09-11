import type { createTerminalController, TerminalInput } from '../../src/browser/terminal';
declare const controller: ReturnType<typeof createTerminalController>;
// @ts-expect-error terminal modes are explicit
controller.open('remote');
// @ts-expect-error callers cannot replace the selected owner
controller.state!.owner = { id: 'other', host: null, generation: 1 };
// @ts-expect-error resize requests require numeric dimensions
const resize: TerminalInput = { type: 'resize', cols: '80', rows: 24 };
// @ts-expect-error sockets belong to the controller
controller.state!.ws = null;
