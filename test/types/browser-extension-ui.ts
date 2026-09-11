import type { ExtensionRequest, ExtensionResponse } from '../../src/browser/extension-ui-data';
import type { ExtensionSession } from '../../src/browser/extension-dialogs';
declare const request: ExtensionRequest;
// @ts-expect-error decoded questions are immutable
request.questions.push({});
// @ts-expect-error method responses must carry the explicit supported payload
const response: ExtensionResponse = { value: { kind: 'execute', command: 'pwd' } };
// @ts-expect-error session identity always includes its host
const session: ExtensionSession = { id: 'session' };
