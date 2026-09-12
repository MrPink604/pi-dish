import type { SessionState, SessionEntry } from './session-state';
import type { HostEndpoint, ApiRequest } from './api-client';
import { createSessionApi, sendJson } from './api-client';
import type { SpawnTarget } from './spawn-targets';
import { escapeHtml } from './helper-format';
import { record } from './helper-values';
import { sessionRefKey } from './helper-identity';
export function createSessionResume(options: {
  document: Document; sessionState: SessionState; request: ApiRequest; endpoint: (host: string | null) => HostEndpoint;
  target: (host: string | null) => SpawnTarget | null; refresh: () => Promise<unknown>;
  select: (id: string, options: { host: string | null }) => unknown; status: (message: string, type?: string) => void;
}) {
  const { document, sessionState } = options, api = createSessionApi(options.request);
  const wrap = document.getElementById('resumeModelWrap'), select = document.getElementById('resumeModelSelect') as HTMLSelectElement | null;
  let sequence = 0, disposed = false; const pending = new Map<string, symbol>();
  function reset() { sequence++; if (wrap) wrap.style.display = 'none'; if (select) { select.disabled = true; select.innerHTML = '<option value="">Session model</option>'; } }
  async function load(session: SessionEntry | null) {
    if (disposed) return; reset(); const owner = sessionState.captureSelection();
    if (!session || session.harnessId !== 'omp' || !owner || owner.id !== session.id || owner.host !== (session.host || null) || !wrap || !select) return;
    const generation = sequence, endpoint = Object.freeze({ ...options.endpoint(owner.host) });
    const owns = () => !disposed && generation === sequence && sessionState.ownsSelection(owner) && options.endpoint(owner.host).base === endpoint.base;
    wrap.style.display = 'flex'; select.title = 'Loading Oh My Pi models…';
    try {
      const models = await api.models(endpoint, { harnessId: 'omp', cwd: session.cwd }); if (!owns()) return;
      const current = session.model && session.model !== 'unknown' ? ` (${session.model})` : '';
      select.innerHTML = `<option value="">Session model${escapeHtml(current)}</option>` + models.map(model => { const name = model.selector || `${model.provider}/${model.id}`; return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`; }).join('');
      select.disabled = false; select.title = 'Optionally override the model while resuming this OMP session';
    } catch (error) { if (owns()) { select.disabled = true; select.title = `Could not load Oh My Pi models: ${error instanceof Error ? error.message : String(error)}`; } }
  }
  async function resume() {
    const owner = sessionState.captureSelection(); if (disposed || !owner) return;
    if (sessionState.currentSession?.capabilities?.resume === false) return;
    const key = sessionRefKey(owner); if (pending.has(key)) return;
    const token = Symbol(), endpoint = Object.freeze({ ...options.endpoint(owner.host) }), target = options.target(owner.host);
    const model = sessionState.currentSession?.harnessId === 'omp' ? select?.value || undefined : undefined;
    const owns = () => !disposed && pending.get(key) === token && sessionState.ownsSelection(owner) && options.endpoint(owner.host).base === endpoint.base;
    pending.set(key, token); options.status(target ? 'Resuming in tmux…' : 'Resuming session...', 'working');
    try {
      const data = await sendJson(options.request, endpoint, `/api/sessions/${encodeURIComponent(owner.id)}/resume`, { ...(target ? { target: { ...target } } : {}), ...(model ? { model } : {}) });
      if (disposed) return; if (!record(data) || typeof data.id !== 'string' || !data.id) throw new Error('Resume returned an invalid session');
      await options.refresh(); if (!owns()) return; options.status('Session resumed'); options.select(data.id, { host: owner.host });
    } catch (error) { if (owns()) options.status('Resume failed: ' + (error instanceof Error ? error.message : String(error)), 'error'); }
    finally { if (pending.get(key) === token) pending.delete(key); }
  }
  return { reset, load, resume, dispose() { if (disposed) return; reset(); disposed = true; pending.clear(); } };
}
