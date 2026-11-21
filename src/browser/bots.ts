import { errorMessage, readJson, sendJson, type ApiRequest } from './api-client';
import { escapeHtml } from '../core/helper-format';
import { record } from '../core/helper-values';

type BotPlace = { label: string; host: string | null; cwd: string };

/** A bot as the sidebar shows it; bots live on the host that serves this page. */
export interface SidebarBot {
  readonly id: string; readonly parentId: string | null; readonly name: string; readonly status: string;
  readonly model: string; readonly thinking: string | null; readonly identity: string; readonly places: readonly BotPlace[];
  /** The bot's session route, as the session list names it. */
  readonly sessionId: string;
}

export function decodeBots(value: unknown): SidebarBot[] {
  const rows = record(value) && Array.isArray(value.bots) ? value.bots : [];
  return rows.flatMap((row: unknown): SidebarBot[] => record(row) && typeof row.id === 'string' && typeof row.name === 'string' ? [{
    id: row.id, parentId: typeof row.parentId === 'string' ? row.parentId : null, name: row.name, status: String(row.status ?? ''),
    model: String(row.model ?? ''), thinking: typeof row.thinking === 'string' ? row.thinking : null,
    identity: typeof row.identity === 'string' ? row.identity : '',
    places: Array.isArray(row.places) ? row.places.flatMap((place: unknown): BotPlace[] => record(place) && typeof place.cwd === 'string' ? [{
      label: String(place.label ?? ''), host: typeof place.host === 'string' ? place.host : null, cwd: place.cwd,
    }] : []) : [],
    sessionId: typeof row.sessionId === 'string' ? row.sessionId : row.id,
  }] : []);
}

/** Places as the form's lines, which `parsePlaces` reads back. */
export function formatPlaces(places: readonly BotPlace[]): string {
  return places.map(place => `${place.label}: ${place.host ? `${place.host}:` : ''}${place.cwd}`).join('\n');
}

/** Bots in tree order, each with its depth; a bot whose parent is not listed is shown at the top. */
export function botTree(bots: readonly SidebarBot[]): { bot: SidebarBot; depth: number }[] {
  const ids = new Set(bots.map(bot => bot.id));
  const children = new Map<string | null, SidebarBot[]>();
  for (const bot of bots) {
    const parent = bot.parentId && ids.has(bot.parentId) ? bot.parentId : null;
    children.set(parent, [...children.get(parent) ?? [], bot]);
  }
  const out: { bot: SidebarBot; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const bot of children.get(parent) ?? []) { out.push({ bot, depth }); walk(bot.id, depth + 1); }
  };
  walk(null, 0);
  return out;
}

/** Turns `label: host:/path` or `label: ~/path` lines into places. */
export function parsePlaces(text: string): BotPlace[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const colon = line.indexOf(':');
    if (colon < 1) throw new Error(`"${line}" needs a label: label: [host:]path`);
    const label = line.slice(0, colon).trim(), where = line.slice(colon + 1).trim();
    const hostColon = where.indexOf(':');
    const host = hostColon > 0 && !where.startsWith('/') && !where.startsWith('~') ? where.slice(0, hostColon) : null;
    const cwd = host ? where.slice(hostColon + 1) : where;
    if (!cwd) throw new Error(`"${line}" needs a path`);
    return { label, host, cwd };
  });
}

/**
 * The Bots group's data and actions: the registry list, the New bot form and the same form to edit a bot, retiring a
 * bot (tap twice), and the undo of a change a bot made, shown in its chat.
 */
export function createBots(options: {
  document: Document; request: ApiRequest; render: () => void; refresh: () => Promise<unknown>;
  select: (sessionId: string) => void; status: (message: string, type?: string) => void;
}) {
  const { document } = options;
  const lifetime = new AbortController();
  let bots: SidebarBot[] = [], armed: string | null = null, armedTimer: ReturnType<typeof setTimeout> | null = null;
  let loading: Promise<void> | null = null, disposed = false;

  function load(): Promise<void> {
    loading ??= (async () => {
      try {
        const response = await options.request(null, '/api/bots');
        const next = response.ok ? decodeBots(await readJson(response)) : [];
        if (!disposed && JSON.stringify(next) !== JSON.stringify(bots)) { bots = next; options.render(); }
      } catch {} finally { loading = null; }
    })();
    return loading;
  }

  function disarm() { clearTimeout(armedTimer ?? undefined); armedTimer = null; armed = null; }

  async function retire(id: string) {
    const bot = bots.find(row => row.id === id);
    if (armed !== id) {
      disarm(); armed = id; armedTimer = setTimeout(() => { disarm(); options.render(); }, 3000); options.render(); return;
    }
    disarm(); options.render();
    try {
      await sendJson(options.request, null, `/api/bots/${encodeURIComponent(id)}/retire`, {});
      options.status(`Retired ${bot?.name ?? 'the bot'}`);
    } catch (error) {
      options.status(`Retire failed: ${errorMessage(error)}`, 'error');
    }
    await load(); await options.refresh();
  }

  async function undo(button: HTMLButtonElement) {
    const { botId, revision, fields } = button.dataset;
    if (!botId || !revision) return;
    button.disabled = true;
    try {
      await sendJson(options.request, null, `/api/bots/${encodeURIComponent(botId)}/restore`, {
        revision: Number(revision) - 1, fields: (fields || '').split(',').filter(Boolean),
      });
      button.textContent = 'Undone';
      await load();
    } catch (error) {
      button.disabled = false;
      options.status(`Undo failed: ${errorMessage(error)}`, 'error');
    }
  }

  function closeForm() { document.getElementById('botNewModal')?.remove(); }

  /** The New bot form, or with `bot` the same form filled in to edit it: the user's own change, any field. */
  function openForm(bot?: SidebarBot) {
    closeForm();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay'; overlay.id = 'botNewModal';
    // An edit cannot put a bot under itself or one of its own sub-bots; the server refuses that and the nesting limit.
    const inside = (row: SidebarBot) => {
      for (let at: SidebarBot | undefined = row; at; at = at.parentId ? bots.find(other => other.id === at!.parentId) : undefined) if (at.id === bot?.id) return true;
      return false;
    };
    const parents = bots.filter(row => row.status !== 'retired' && !inside(row));
    const thinking = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
      .map(level => `<option${bot?.thinking === level ? ' selected' : ''}>${level}</option>`).join('');
    overlay.innerHTML = `<form class="modal bot-form" id="botNewForm">
      <div class="modal-header"><h3>${bot ? `Edit ${escapeHtml(bot.name)}` : 'New bot'}</h3><button type="button" class="btn-icon" id="botCancelBtn" title="Cancel">✕</button></div>
      <div class="bot-form-body">
        <label>Name <input id="botName" required maxlength="80" autocomplete="off" value="${escapeHtml(bot?.name ?? '')}"></label>
        <label>Identity <textarea id="botIdentity" required rows="6" placeholder="You are … the standing contact for …">${escapeHtml(bot?.identity ?? '')}</textarea></label>
        <label>Model <input id="botModel" value="${escapeHtml(bot?.model ?? 'claude-code/claude-opus-5-5')}" autocomplete="off"></label>
        <label>Thinking <select id="botThinking"><option value="">default</option>${thinking}</select></label>
        <label>Parent <select id="botParent"><option value="">none (top level)</option>${parents.map(row => `<option value="${escapeHtml(row.id)}"${bot?.parentId === row.id ? ' selected' : ''}>${escapeHtml(row.name)}</option>`).join('')}</select></label>
        <label>Places <textarea id="botPlaces" rows="3" placeholder="notes: ~/notes&#10;services: tycho:/srv">${escapeHtml(bot ? formatPlaces(bot.places) : '')}</textarea></label>
        ${bot ? '<p class="bot-form-note">A new model restarts the bot. A new identity, places or thinking level take effect at its next context window. A new parent moves the bot with its sub-bots, and its room becomes its new family\'s.</p>' : ''}
        <div class="bot-form-error" id="botFormError" role="alert"></div>
      </div>
      <div class="modal-footer"><button type="submit" class="btn" id="botCreateBtn">${bot ? 'Save' : 'Create and start'}</button></div>
    </form>`;
    document.body.append(overlay);
    const form = overlay.querySelector<HTMLFormElement>('#botNewForm')!;
    const value = (id: string) => (overlay.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`)?.value ?? '').trim();
    overlay.querySelector('#botCancelBtn')!.addEventListener('click', closeForm);
    overlay.addEventListener('click', event => { if (event.target === overlay) closeForm(); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const error = overlay.querySelector<HTMLElement>('#botFormError')!, submit = overlay.querySelector<HTMLButtonElement>('#botCreateBtn')!;
      error.textContent = '';
      let body: Record<string, unknown>;
      try {
        body = { name: value('botName'), identity: value('botIdentity'), places: parsePlaces(value('botPlaces')) };
      } catch (problem) { error.textContent = errorMessage(problem); return; }
      if (value('botModel')) body.model = value('botModel');
      // An edit sets every field: "default" clears the thinking level, and "none" makes the bot top level.
      if (value('botThinking') || bot) body.thinking = value('botThinking') || null;
      if (value('botParent') || bot) body.parentId = value('botParent') || null;
      submit.disabled = true;
      try {
        const saved = await sendJson(options.request, null, bot ? `/api/bots/${encodeURIComponent(bot.id)}` : '/api/bots', body, bot ? 'PATCH' : 'POST');
        const row = decodeBots({ bots: [record(saved) ? saved.bot : null] })[0];
        closeForm();
        await load(); await options.refresh();
        if (bot) options.status(`Saved ${row?.name ?? bot.name}`);
        else if (row) options.select(row.sessionId);
      } catch (problem) {
        error.textContent = errorMessage(problem); submit.disabled = false;
      }
    });
    overlay.querySelector<HTMLInputElement>('#botName')!.focus();
  }

  function mount() {
    // Capture: these buttons sit inside session rows, whose own click selects the session.
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>('.bot-new-btn, .bot-edit-btn, .bot-retire-btn, .bot-change-undo');
      if (!button || disposed) return;
      event.preventDefault(); event.stopPropagation();
      if (button.classList.contains('bot-new-btn')) openForm();
      else if (button.classList.contains('bot-edit-btn')) {
        const bot = bots.find(row => row.id === button.dataset.botId);
        if (bot) openForm(bot);
      } else if (button.classList.contains('bot-retire-btn')) void retire(button.dataset.botId || '');
      else void undo(button);
    }, { capture: true, signal: lifetime.signal });
    void load();
  }

  function dispose() { disposed = true; disarm(); lifetime.abort(); closeForm(); }

  return { get list(): readonly SidebarBot[] { return bots; }, get armed() { return armed; }, load, mount, dispose };
}
