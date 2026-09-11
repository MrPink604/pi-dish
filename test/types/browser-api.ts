import { createSessionApi, createHostTransport } from '../../src/browser/api-client';
const api = createSessionApi(async () => new Response());
const owner = { id: 'session', host: 'peer', generation: 1 };
api.setModel(owner, 'provider/model');
api.setThinking(owner, 'high');
api.models('peer', { harnessId: 'omp', cwd: '/workspace' });
// @ts-expect-error A bare id cannot own a session mutation.
api.setModel('session', 'provider/model');
// @ts-expect-error Host/generation cannot be omitted from an owner.
api.rename({ id: 'session' }, 'name');
// @ts-expect-error The selector is a string, not a model record.
api.setModel(owner, { id: 'model' });
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
