import type { ExtensionUIState } from './contracts';
import type { ProtocolRecord } from './wire-protocol';

const DIALOG_METHODS: Record<string, true> = { select: true, confirm: true, input: true, editor: true, ask: true };

export function createExtensionUIState(): ExtensionUIState {
  return { widgets: new Map(), statuses: new Map(), dialogs: new Map() };
}

export function removeExtensionUIDialog(state: ExtensionUIState, id: unknown): void {
  state.dialogs.delete(id);
}

/** Reduce admitted transport events before listeners observe the live replay maps. */
export function reduceExtensionUIState(state: ExtensionUIState, event: string, data: unknown): void {
  if (event === 'session_switch') {
    state.widgets.clear();
    state.statuses.clear();
    state.dialogs.clear();
    return;
  }
  // Read only consumed properties; preserve native boxing and opaque payloads/keys.
  const payload = data as ProtocolRecord | null | undefined;
  if (event === 'extension_ui_request' && payload?.method) {
    if (payload.method === 'setWidget') {
      const key = payload.widgetKey || 'default';
      if (Array.isArray(payload.widgetLines) && payload.widgetLines.length) state.widgets.set(key, data);
      else state.widgets.delete(key);
    } else if (payload.method === 'setStatus') {
      const key = payload.statusKey || 'default';
      if (payload.statusText) state.statuses.set(key, data);
      else state.statuses.delete(key);
    } else if (typeof payload.method === 'string' && Object.hasOwn(DIALOG_METHODS, payload.method) && payload.id) {
      state.dialogs.set(payload.id, data);
    }
  } else if (event === 'extension_ui_resolved' && payload?.id) {
    removeExtensionUIDialog(state, payload.id);
  }
}
