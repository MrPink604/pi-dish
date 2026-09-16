import { createSessionApi, createHostTransport, setSessionModel, setSessionThinking, renameSession } from '../../src/browser/api-client';
const request = async () => new Response();
const api = createSessionApi(request);
const endpoint = { base: 'https://peer.invalid', token: 'fixture' };
setSessionModel(request, endpoint, 'session', 'provider/model');
setSessionThinking(request, endpoint, 'session', 'high');
renameSession(request, endpoint, 'session', 'name');
api.models('peer', { harnessId: 'omp', cwd: '/workspace' });
// @ts-expect-error A host lookup id is not a captured endpoint.
setSessionModel(request, 'peer', 'session', 'provider/model');
// @ts-expect-error A selection owner is not a route session id.
renameSession(request, endpoint, { id: 'session', host: 'peer', generation: 1 }, 'name');
// @ts-expect-error The selector is a string, not a model record.
setSessionModel(request, endpoint, 'session', { id: 'model' });
// @ts-expect-error Host resolution must provide a usable base URL.
createHostTransport({ resolveHost: () => ({}), fetch });
api.models(null).then(models => {
  const enabled: boolean | undefined = models[0]?.enabled;
  // @ts-expect-error Unknown metadata cannot be consumed without narrowing.
  const other: string = models[0]!.custom;
  void [enabled, other];
});

import { mountModelSelector } from '../../src/browser/model-selector';
import type { ModelSelectorView, ModelSelectorActions } from '../../src/browser/model-selector';
declare const selectorView: ModelSelectorView;
// @ts-expect-error The component cannot retarget its captured owner.
selectorView.owner.host = 'other';
// @ts-expect-error Catalog ownership stays outside the component.
selectorView.models.push({});
declare const selectorActions: ModelSelectorActions;
// @ts-expect-error The first selection argument is its owner, not a bare selector string.
mountModelSelector(document.createElement('div'), { ...selectorActions, selectModel: (selector: string) => {} }, String);
