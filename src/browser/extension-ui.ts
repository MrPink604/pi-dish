import type { ApiRequest, HostEndpoint } from './api-client';
import type { SessionState } from './session-state';
import type { ExtensionSession } from './extension-dialogs';
import { createExtensionDialogs } from './extension-dialogs';
import { createExtensionDisplay } from './extension-display';
import { decodeExtensionRequest } from './extension-ui-data';
export function createExtensionUI(options: {
  document: Document; sessionState: SessionState; storage: Pick<Storage, 'getItem' | 'setItem'>;
  request: ApiRequest; host: (id: string | null) => HostEndpoint | null; status: (message: string, type?: string) => void;
}) {
  const { document, sessionState } = options;
  const display = createExtensionDisplay(options), dialogs = createExtensionDialogs({ ...options, toast: display.toast });
  let disposed = false;
  function handle(value: unknown, session: ExtensionSession) {
    const selected = sessionState.currentSession;
    if (disposed || !selected || selected.id !== session.id || (selected.host || null) !== session.host) return;
    const request = decodeExtensionRequest(value); if (!request) return;
    switch (request.method) {
      case 'notify': display.toast(request.message, request.notifyType); break;
      case 'setWidget': display.widget(request.widgetKey, request.widgetLines, request.widgetPlacement); break;
      case 'setStatus': display.status(request.statusKey, request.statusText); break;
      case 'setTitle': document.title = request.title || 'pi-dish'; break;
      case 'set_editor_text': {
        const input = document.getElementById('promptInput') as HTMLTextAreaElement | null;
        if (input) { input.value = request.text; input.dispatchEvent(new Event('input')); } break;
      }
      case 'select': case 'confirm': case 'input': case 'editor': case 'ask': dialogs.show(request, session); break;
      default: display.toast(`[${request.method}] ${JSON.stringify(request).slice(0, 200)}`, 'info');
    }
  }
  return { handle, clear() { if (!disposed) { display.clear(); dialogs.detach(); } },
    resolve: dialogs.resolved, reconcile: dialogs.reconcile, end: dialogs.removeSession,
    dispose() { disposed = true; display.dispose(); dialogs.dispose(); },
  };
}
