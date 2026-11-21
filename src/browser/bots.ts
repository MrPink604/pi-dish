import { errorMessage, readJson, sendJson, type ApiRequest } from './api-client';
import { escapeHtml } from '../core/helper-format';
import { finite, record } from '../core/helper-values';
import { sessionRefKey } from './helper-identity';
import { buildSessionFamilies, flattenSessionFamilies, resolveParentKey, sessionFamilyParentId } from './helper-sessions';
import type { SessionEntry } from './session-state';
import type { SessionFamily } from './shared-helper-types';

type BotPlace = { label: string; host: string | null; cwd: string };

export const BOT_COLLAPSE_PREFIX = 'bot:';
export const BOT_CLOSED_PREFIX = 'bot-closed:';
export function botCollapseKey(botId: string): string { return BOT_COLLAPSE_PREFIX + botId; }
export function botClosedKey(botId: string): string { return BOT_CLOSED_PREFIX + botId; }

const HOST_QUALIFIED_PARENT = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.+)$/i;

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

export interface BotTreeNode {
  readonly bot: SidebarBot;
  readonly depth: number;
  readonly session: SessionEntry | null;
  readonly activeWorkers: readonly SessionFamily<SessionEntry>[];
  readonly closedWorkers: readonly SessionFamily<SessionEntry>[];
  readonly children: readonly BotTreeNode[];
  readonly activeWorkerCount: number;
  readonly closedWorkerCount: number;
  readonly subBotCount: number;
  readonly descendantCount: number;
  readonly allSessions: readonly SessionEntry[];
  readonly activity: number;
}

export interface BotSessionTree {
  readonly roots: readonly BotTreeNode[];
  /** Keys (`sessionRefKey`) of every bot session and worker session placed in this tree. */
  readonly claimed: ReadonlySet<string>;
  readonly botCount: number;
}

export interface BotRevealPath {
  readonly expandBots: readonly string[];
  readonly expandClosedBot: string | null;
  readonly expandFamilies: readonly string[];
}

function activityMs(session: SessionEntry): number {
  const value = new Date(session.lastActivity || 0).getTime();
  return finite(value) ? value : 0;
}

function familyHasLiveMember(family: SessionFamily<SessionEntry>): boolean {
  return flattenSessionFamilies([family]).some(session => session.isActive || session.subagentLive);
}

/**
 * Partition visible sessions into a bot hierarchy (up to 4 levels of bots,
 * each owning its local and cross-host worker sessions plus their descendant
 * sessions) and the remaining unclaimed sessions.
 */
export function buildBotSessionTree(
  bots: readonly SidebarBot[],
  sessions: readonly SessionEntry[],
  selfHostId?: string | null,
  bridgePool?: readonly SessionEntry[] | null,
): BotSessionTree {
  const liveBots = bots.filter(bot => bot.status !== 'retired');
  if (!liveBots.length) return { roots: [], claimed: new Set(), botCount: 0 };

  const botById = new Map<string, SidebarBot>();
  const botByRoute = new Map<string, SidebarBot>();
  for (const bot of liveBots) {
    botById.set(bot.id, bot);
    botByRoute.set(bot.sessionId, bot);
    botByRoute.set(bot.id, bot);
  }

  let botHost: string | null = selfHostId || null;
  if (!botHost) {
    const matched = sessions.find(session => session.harnessId === 'bot' && botByRoute.has(session.id));
    botHost = matched?.host || null;
  }
  const botHostLower = botHost ? botHost.toLowerCase() : null;

  const botSessionById = new Map<string, SessionEntry>();
  const claimed = new Set<string>();
  const hostByLower = new Map<string, string>();
  const registerHost = (host?: string | null) => {
    if (host) {
      const lower = host.toLowerCase();
      if (!hostByLower.has(lower)) hostByLower.set(lower, host);
    }
  };
  for (const session of sessions) {
    registerHost(session.host);
    if (session.harnessId !== 'bot') continue;
    const owner = botByRoute.get(session.id);
    if (!owner) continue;
    const sessionHostLower = session.host ? session.host.toLowerCase() : null;
    if (botHostLower !== null && sessionHostLower !== null && sessionHostLower !== botHostLower) continue;
    if (!botSessionById.has(owner.id)) botSessionById.set(owner.id, session);
    claimed.add(sessionRefKey(session));
  }

  const parentBotOf = (session: SessionEntry): SidebarBot | null => {
    const parentId = session.parentId;
    if (!parentId) return null;
    const qualified = HOST_QUALIFIED_PARENT.exec(parentId);
    if (qualified) {
      if (botHostLower === null || qualified[1].toLowerCase() !== botHostLower) return null;
      return botByRoute.get(qualified[2]) ?? null;
    }
    const sessionHostLower = session.host ? session.host.toLowerCase() : null;
    if (sessionHostLower !== botHostLower) return null;
    return botByRoute.get(parentId) ?? null;
  };

  const sessionsByKey = new Map<string, SessionEntry>();
  const nonBotSessions: SessionEntry[] = [];
  for (const session of sessions) {
    const key = sessionRefKey(session);
    if (!sessionsByKey.has(key)) sessionsByKey.set(key, session);
    if (!claimed.has(key)) nonBotSessions.push(session);
  }

  const poolByKey = new Map<string, SessionEntry>();
  for (const session of bridgePool || []) {
    if (!session?.id) continue;
    registerHost(session.host);
    const key = sessionRefKey(session);
    if (!sessionsByKey.has(key) && !claimed.has(key) && !poolByKey.has(key)) poolByKey.set(key, session);
  }

  const workerSessionsByBot = new Map<string, SessionEntry[]>();
  const workerOwnerByKey = new Map<string, string>();
  const bridgePoolByBot = new Map<string, Map<string, SessionEntry>>();
  const bridgeRootsByBot = new Map<string, Set<string>>();
  const addWorker = (botId: string, session: SessionEntry) => {
    const key = sessionRefKey(session);
    workerOwnerByKey.set(key, botId);
    claimed.add(key);
    const list = workerSessionsByBot.get(botId);
    if (list) list.push(session);
    else workerSessionsByBot.set(botId, [session]);
  };
  const addBridge = (botId: string, key: string, session: SessionEntry, isRoot: boolean) => {
    let map = bridgePoolByBot.get(botId);
    if (!map) { map = new Map(); bridgePoolByBot.set(botId, map); }
    map.set(key, session);
    workerOwnerByKey.set(key, botId);
    if (isRoot) {
      let set = bridgeRootsByBot.get(botId);
      if (!set) { set = new Set(); bridgeRootsByBot.set(botId, set); }
      set.add(key);
    }
  };

  for (const session of nonBotSessions) {
    const owner = parentBotOf(session);
    if (owner) addWorker(owner.id, session);
  }

  // Claim descendants of already-claimed workers across workspaces and hosts,
  // walking through closed intermediate parents in `bridgePool` when present.
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const session of nonBotSessions) {
      const key = sessionRefKey(session);
      if (workerOwnerByKey.has(key)) continue;
      const chain: [string, SessionEntry][] = [];
      const seen = new Set<string>([key]);
      let cursor: SessionEntry | undefined = session;
      let resolvedBotId: string | null = null;
      let topPoolKey: string | null = null;
      while (cursor) {
        const directBot = cursor === session ? null : parentBotOf(cursor);
        if (directBot) {
          resolvedBotId = directBot.id;
          topPoolKey = sessionRefKey(cursor);
          break;
        }
        const parentKey = resolveParentKey(cursor.host, sessionFamilyParentId(cursor), hostByLower);
        if (!parentKey || seen.has(parentKey)) break;
        seen.add(parentKey);
        const ownerBotId = workerOwnerByKey.get(parentKey);
        if (ownerBotId) {
          resolvedBotId = ownerBotId;
          break;
        }
        const pooled = poolByKey.get(parentKey);
        if (!pooled) break;
        chain.push([parentKey, pooled]);
        cursor = pooled;
      }
      if (!resolvedBotId) continue;
      for (const [bKey, bSession] of chain) addBridge(resolvedBotId, bKey, bSession, bKey === topPoolKey);
      addWorker(resolvedBotId, session);
      progressed = true;
    }
  }

  const childrenByParent = new Map<string | null, SidebarBot[]>();
  for (const bot of liveBots) {
    const parent = bot.parentId && botById.has(bot.parentId) ? bot.parentId : null;
    const list = childrenByParent.get(parent);
    if (list) list.push(bot);
    else childrenByParent.set(parent, [bot]);
  }

  const visited = new Set<string>();
  const buildNode = (bot: SidebarBot, depth: number): BotTreeNode => {
    visited.add(bot.id);
    const session = botSessionById.get(bot.id) ?? null;
    const botBridges = bridgePoolByBot.get(bot.id);
    const families = buildSessionFamilies(workerSessionsByBot.get(bot.id) ?? [], {
      bridgePool: botBridges ? [...botBridges.values()] : undefined,
      bridgeRoots: bridgeRootsByBot.get(bot.id),
    });
    const activeWorkers: SessionFamily<SessionEntry>[] = [];
    const closedWorkers: SessionFamily<SessionEntry>[] = [];
    for (const family of families) {
      if (familyHasLiveMember(family)) activeWorkers.push(family);
      else closedWorkers.push(family);
    }
    const children = (childrenByParent.get(bot.id) ?? [])
      .filter(child => !visited.has(child.id))
      .map(child => buildNode(child, depth + 1));

    const activeWorkerSessions = flattenSessionFamilies(activeWorkers);
    const closedWorkerSessions = flattenSessionFamilies(closedWorkers);
    const activeWorkerCount = activeWorkerSessions.length;
    const closedWorkerCount = closedWorkerSessions.length;
    const subBotCount = children.reduce((sum, child) => sum + 1 + child.subBotCount, 0);
    const descendantCount = activeWorkerCount + closedWorkerCount
      + children.reduce((sum, child) => sum + 1 + child.descendantCount, 0);
    const allSessions = [
      ...(session ? [session] : []),
      ...activeWorkerSessions,
      ...closedWorkerSessions,
      ...children.flatMap(child => child.allSessions),
    ];
    let activity = session ? activityMs(session) : 0;
    for (const worker of activeWorkers) activity = Math.max(activity, worker.activity);
    for (const worker of closedWorkers) activity = Math.max(activity, worker.activity);
    for (const child of children) activity = Math.max(activity, child.activity);
    return {
      bot, depth, session, activeWorkers, closedWorkers, children,
      activeWorkerCount, closedWorkerCount, subBotCount, descendantCount, allSessions, activity,
    };
  };

  const roots = (childrenByParent.get(null) ?? []).map(bot => buildNode(bot, 0));
  return { roots, claimed, botCount: liveBots.length };
}

function findInFamily(node: SessionFamily<SessionEntry>, targetKey: string, ancestors: readonly string[]): string[] | null {
  if (sessionRefKey(node.session) === targetKey) return [...ancestors];
  const next = [...ancestors, sessionRefKey(node.session)];
  for (const child of node.children) {
    const found = findInFamily(child, targetKey, next);
    if (found) return found;
  }
  return null;
}

/** Locate a bot or worker session in the bot tree and return the containers to expand to reveal it. */
export function findBotRevealPath(bots: readonly SidebarBot[], sessions: readonly SessionEntry[], targetKey: string,
  selfHostId?: string | null): BotRevealPath | null {
  const tree = buildBotSessionTree(bots, sessions, selfHostId);
  const walk = (node: BotTreeNode, ancestorBots: readonly string[]): BotRevealPath | null => {
    if (node.session && sessionRefKey(node.session) === targetKey) {
      return { expandBots: [...ancestorBots], expandClosedBot: null, expandFamilies: [] };
    }
    const withSelf = [...ancestorBots, node.bot.id];
    for (const worker of node.activeWorkers) {
      const families = findInFamily(worker, targetKey, []);
      if (families) return { expandBots: withSelf, expandClosedBot: null, expandFamilies: families };
    }
    for (const worker of node.closedWorkers) {
      const families = findInFamily(worker, targetKey, []);
      if (families) return { expandBots: withSelf, expandClosedBot: node.bot.id, expandFamilies: families };
    }
    for (const child of node.children) {
      const found = walk(child, withSelf);
      if (found) return found;
    }
    return null;
  };
  for (const root of tree.roots) {
    const found = walk(root, []);
    if (found) return found;
  }
  return null;
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
