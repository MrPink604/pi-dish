import { createModelCatalog } from '../../src/browser/model-catalog';
import { createAppModels } from '../../src/browser/app-models';
import { createSessionApi } from '../../src/browser/api-client';
import { mountModelSelector } from '../../src/browser/model-selector';
import type { SelectionOwner, SessionState } from '../../src/browser/session-state';
declare const owner: SelectionOwner;
const api = createSessionApi(async () => new Response());
const catalog = createModelCatalog({ read: scope => api.models(scope.host, scope), persist: (_scope, rows) => {
  // @ts-expect-error persistence receives readonly rows
  rows.push({});
}, changed: () => {}, failed: (_error: unknown) => {} });
catalog.seed({ host: { hostId: 'a', base: '/a' }, harnessId: 'pi' }, [], () => true);
// @ts-expect-error external callers must use the enabled-model writers
catalog.rows()[0].enabled = false;
// @ts-expect-error catalog rows cannot be replaced externally
catalog.rows()[0] = {};
// @ts-expect-error a catalog read needs a host endpoint
catalog.load({ host: 'a', harnessId: 'pi' }, () => true);
declare const selector: ReturnType<typeof mountModelSelector>;
selector.update({ owner, models: catalog.rows(), currentModel: null, harnessId: 'pi', query: '', editMode: false });

declare const sessions: SessionState;
const appModels = createAppModels({ sessions, catalog, host: () => ({ hostId: 'a', base: '/a' }) });
void appModels.load('session');
void appModels.load('session', 'pi');
// @ts-expect-error takeover catalogs do not enter the session adapter without a session
void appModels.load();
// @ts-expect-error undefined is not a session id
void appModels.load(undefined);
// @ts-expect-error null is not a session id
void appModels.load(null);
