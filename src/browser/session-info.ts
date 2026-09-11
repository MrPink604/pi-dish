import type { ApiRequest, HostEndpoint, RequestOptions } from './api-client';
import type { SessionState, SelectionOwner, SessionEntry } from './session-state';
import type { SessionShare, PublishedPage } from './session-info-data';
import { decodeSessionStats, decodeSessionShare, decodePublishedPages } from './session-info-data';
import { escapeHtml, formatTokSpeed, formatTokens, formatDuration, formatUsageCost, formatCacheStat, formatRuntime, formatRelativeTime } from './helper-format';

import { record } from './helper-values';
export function createSessionInfo(options: {
  document: Document; request: ApiRequest; sessionState: SessionState; host: (id: string | null) => HostEndpoint | null;
  reference: (session: SessionEntry) => string; copy: (text: string) => Promise<unknown>; status: (message: string, type?: string) => void; confirm: (message: string) => boolean;
  loadPrevious: () => Promise<unknown>; refreshSessions: () => Promise<unknown>; selectSession: (id: string, options: { host: string | null }) => Promise<unknown>;
}) {
  const { document, sessionState } = options, location = document.defaultView!.location;
  const copyTextToClipboard = options.copy, setStatus = options.status, confirm = options.confirm, sessionRefFor = options.reference;
  const apiFetch = options.request, refreshSessions = options.refreshSessions, selectSession = options.selectSession;
  const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
  const element = <T extends HTMLElement = HTMLElement>(id: string) => { const value = document.getElementById(id); if (!value) throw new Error('Missing session info element: ' + id); return value as T; };
  let disposed = false;
  let statsEndpoint: Readonly<HostEndpoint> | null = null;
  let statsEvents = new AbortController(), shareEvents = new AbortController(), pagesEvents = new AbortController(), processEvents = new AbortController(), artifactEvents = new AbortController();
  let shareSequence = 0, pagesSequence = 0, artifactGeneration = 0;
  let artifactOwner: SelectionOwner | null = null, artifactEndpoint: Readonly<HostEndpoint> | null = null;
  let messageCopies = new WeakMap<HTMLElement, symbol>();
  const statsTimers = new Set<ReturnType<typeof setTimeout>>(), messageTimers = new Set<ReturnType<typeof setTimeout>>();
  function clearTimers(timers: Set<ReturnType<typeof setTimeout>>) { for (const timer of timers) clearTimeout(timer); timers.clear(); }
  function later(timers: Set<ReturnType<typeof setTimeout>>, callback: () => void) { const timer = setTimeout(() => { timers.delete(timer); callback(); }, 1200); timers.add(timer); }
  function endpoint(owner: SelectionOwner): Readonly<HostEndpoint> | null { const host = options.host(owner.host); return host ? Object.freeze({ ...host }) : null; }
  function owns(owner: SelectionOwner | null, host: Readonly<HostEndpoint> | null): owner is SelectionOwner {
    if (disposed || !owner || !host || !sessionState.ownsSelection(owner)) return false;
    const current = options.host(owner.host); return !!current && current.base === host.base && (current.token || '') === (host.token || '');
  }
  function sessionSupports(session: SessionEntry | undefined, capability: string) { const capabilities = session?.capabilities; return !record(capabilities) || capabilities[capability] !== false; }
  async function json(host: HostEndpoint, path: string, init?: RequestOptions): Promise<unknown> {
    const response = await apiFetch(host, path, init); const data: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(record(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
    return data;
  }
  async function shareFor(host: HostEndpoint, id: string): Promise<SessionShare | null> {
    const response = await apiFetch(host, `/api/sessions/${encodeURIComponent(id)}/share`);
    if (response.status === 404) return null;
    const value: unknown = await response.json();
    if (!response.ok) throw new Error(record(value) && typeof value.error === 'string' ? value.error : `HTTP ${response.status}`);
    return decodeSessionShare(value);
  }

  async function apiSend(host: HostEndpoint, path: string): Promise<unknown> {
    const response = await apiFetch(host, path, { method: 'POST' }); const data: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(record(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
    return data;
  }

  // --- Session stats modal ---
  let statsModalGeneration = 0;
  let statsModalOwner: SelectionOwner | null = null;

  function ownsStatsModal(owner: SelectionOwner | null, generation: number) {
    return statsModalOwner === owner && owns(owner, statsEndpoint) && statsModalGeneration === generation &&
      element('statsModal').style.display !== 'none';
  }

  function openStatsModal() {
    if (disposed || !sessionState.currentSession) return;
    const owner = sessionState.captureSelection(); if (!owner) return;
    const sessionId = owner.id;
    // Resolved now, while the selection is certainly this session — the stats
    // response lands a round-trip later.
    const host = endpoint(owner); if (!host) return;
    closeStatsModal(); statsEndpoint = host;
    const ref = sessionRefFor(sessionState.currentSession);
    const generation = ++statsModalGeneration;
    statsModalOwner = owner;
    const modal = element('statsModal');
    const body = element('statsBody');
    modal.style.display = 'flex';
    body.textContent = 'Loading...';
    statsEvents = new AbortController();
    body.addEventListener('click', event => {
      if (!(event.target instanceof Element) || !ownsStatsModal(owner, generation)) return;
      const button = event.target.closest<HTMLElement>('.stats-copy'); if (!button || !body.contains(button)) return;
      void copyTextToClipboard(button.dataset.copy || '').then(() => {
        if (!ownsStatsModal(owner, generation) || !button.isConnected) return;
        const original = button.textContent; button.classList.add('copied'); button.textContent = 'Copied ✓';
        later(statsTimers, () => { if (ownsStatsModal(owner, generation) && button.isConnected) { button.textContent = original; button.classList.remove('copied'); } });
      }, () => { if (ownsStatsModal(owner, generation)) setStatus('Copy failed (clipboard blocked)', 'error'); });
    }, { signal: statsEvents.signal });
    json(host, `/api/sessions/${encodeURIComponent(sessionId)}/stats`)
      .then(decodeSessionStats)
      .then(s => {
        if (!ownsStatsModal(owner, generation)) return;
        const cu = s.contextUsage || {};
        // Session-wide effective speed: output tokens over the summed
        // per-message response time (only messages with measurable timing).
        const avgSpeed = formatTokSpeed(s.genOutput, s.genMs);
        // [key, value, copyable?] — copyable rows render the value as a
        // click-to-copy button (paths, handy for jumping to the file in a shell).
        const rows: ([string, string, boolean?] | null)[] = [
          ['__section', 'Summary'],
          // The pasteable handle for this session, click-to-copy like the paths
          // below it — the modal-side twin of the sidebar row's context menu.
          ['Ref', ref, !!ref],
          ['Model', s.model || '—'],
          ['Thinking', s.thinkingLevel || '—'],
          ['Context', (cu.tokens != null ? formatTokens(cu.tokens) : '—') +
            ' / ' + (cu.contextWindow ? formatTokens(cu.contextWindow) : '—') +
            (cu.percent != null ? ` (${Math.round(cu.percent * 10) / 10}%)` : '')],
          ['Messages', `${s.userMessages} user · ${s.assistantMessages} assistant · ${s.toolCalls} tool calls`],
          // Always shown, including zero: how often the context was rebuilt is
          // read together with the Context row above it.
          ['Compactions', String(s.compactions ?? 0)],
          ['__section', 'Performance'],
          s.responseTiming?.medianMs ? ['Response time', `${formatDuration(s.responseTiming.medianMs)} median · ${formatDuration(s.responseTiming.slowestMs)} slowest`] : null,
          avgSpeed ? ['Effective speed', `${avgSpeed} avg · ${formatDuration(s.genMs)} measured response time`] : null,
          ['__section', 'Tokens & cache'],
          ['Tokens in / out', `${formatTokens(s.tokens?.input)} / ${formatTokens(s.tokens?.output)}`],
          s.reasoningTokens ? ['Reasoning', formatTokens(s.reasoningTokens)] : null,
          ['Cache', formatCacheStat(s.tokens?.cacheRead, s.tokens?.cacheWrite, s.tokens?.input)],
          ['__section', 'Estimated spend'],
          ['Estimated total', formatUsageCost(s.costs?.total ?? s.cost, s.costUnavailable?.total)],
          ['Components', `input ${formatUsageCost(s.costs?.input, s.costUnavailable?.input)} · output ${formatUsageCost(s.costs?.output, s.costUnavailable?.output)} · cache read ${formatUsageCost(s.costs?.cacheRead, s.costUnavailable?.cacheRead)} · write ${formatUsageCost(s.costs?.cacheWrite, s.costUnavailable?.cacheWrite)}`],
          ['__section', 'Location'],
          s.runtime ? ['Running in', formatRuntime(s.runtime)] : null,
          ['cwd', s.cwd || '—', !!s.cwd],
          ['Session file', s.sessionFile || '—', !!s.sessionFile],
        ];
        body.innerHTML = '<table class="stats-table">' + rows.filter((row): row is [string, string, boolean?] => row !== null).map(([k, v, copyable]) => {
          if (k === '__section') return `<tr class="stats-section"><th colspan="2">${escapeHtml(v)}</th></tr>`;
          const val = copyable
            ? `<button type="button" class="stats-copy" data-copy="${escapeHtml(String(v))}" title="Click to copy">${escapeHtml(String(v))}</button>`
            : escapeHtml(String(v));
          return `<tr><td class="stats-key">${escapeHtml(k)}</td><td class="stats-val">${val}</td></tr>`;
        }).join('') + '</table><div class="telemetry-note">Spend is estimated from the session harness catalog, not provider-billed. Response time is request start → JSONL append; effective speed includes TTFT.</div>' +
          '<div class="stats-share" id="statsShare"></div>' +
          '<div class="stats-share" id="statsPages"></div>' +
          '<div class="stats-share" id="statsClose"></div>';
        loadShareSection(owner, generation);
        loadPagesSection(owner, generation);
        renderCloseSection(owner, generation);
      })
      .catch(e => {
        if (ownsStatsModal(owner, generation)) body.textContent = 'Failed to load stats: ' + errorMessage(e);
      });
  }

  // Public share link section of the stats modal. Fetches current state (404 =
  // no share) and renders either a "Create share link" button or the existing
  // link as a click-to-copy row plus a Revoke button.
  async function loadShareSection(owner: SelectionOwner, generation: number): Promise<void> {
    if (!ownsStatsModal(owner, generation) || !statsEndpoint) return;
    const host = statsEndpoint, sequence = ++shareSequence, element = document.getElementById('statsShare'); if (!element) return;
    if (!sessionSupports(sessionState.findSession(owner.id, owner.host), 'export')) { element.remove(); return; }
    element.innerHTML = '<div class="stats-share-title">Public share link</div><div class="stats-share-body">Loading…</div>';
    try { const share = await shareFor(host, owner.id); if (sequence === shareSequence) renderShareSection(owner, share, generation); }
    catch { if (sequence === shareSequence) renderShareSection(owner, null, generation); }
  }
  function renderShareSection(owner: SelectionOwner, share: SessionShare | null, generation: number): void {
    if (!ownsStatsModal(owner, generation) || !statsEndpoint) return;
    shareEvents.abort(); shareEvents = new AbortController();
    const sequence = ++shareSequence, host = statsEndpoint;
    const current = () => sequence === shareSequence && ownsStatsModal(owner, generation);
    const element = document.getElementById('statsShare'); if (!element) return;
    const body = element.querySelector('.stats-share-body') || element;
    const link = share ? share.url || location.origin + share.path : '';
    body.innerHTML = share
      ? `<button type="button" class="stats-copy stats-share-link" data-copy="${escapeHtml(link)}" title="Click to copy">${escapeHtml(link)}</button><button type="button" class="btn-small btn-danger" id="shareRevokeBtn">Revoke</button>`
      : '<button type="button" class="btn-small" id="shareCreateBtn">Create share link</button><div class="stats-share-hint">Anyone with the link can view this session read-only.</div>';
    const button = body.querySelector<HTMLButtonElement>(share ? '#shareRevokeBtn' : '#shareCreateBtn')!;
    button.addEventListener('click', async () => {
      if (!current() || button.disabled) return; button.disabled = true;
      try {
        const data = await json(host, `/api/sessions/${encodeURIComponent(owner.id)}/share`, { method: share ? 'DELETE' : 'POST' });
        const next = share ? null : decodeSessionShare(data); if (!share && !next) throw new Error('Invalid share response');
        if (!current()) return; renderShareSection(owner, next, generation); void refreshArtifacts(owner);
      } catch (error) { if (current()) { button.disabled = false; setStatus(`Failed to ${share ? 'revoke' : 'create'} share: ` + errorMessage(error), 'error'); } }
    }, { signal: shareEvents.signal });
  }
  // Message links may create a public transcript only after the user's existing confirmation.
  async function copyMessageShareLink(button: HTMLElement): Promise<void> {
    const owner = sessionState.captureSelection(), id = button.dataset.entryId;
    if (disposed || !owner || !id || messageCopies.has(button)) return;
    const host = endpoint(owner); if (!host) return;
    const token = Symbol(); messageCopies.set(button, token);
    const current = () => owns(owner, host) && messageCopies.get(button) === token;
    try {
      let share = await shareFor(host, owner.id); if (!current()) return;
      if (!share) {
        if (!confirm('No share link exists for this session yet — create one? Anyone with the link can view the whole session read-only.') || !current()) return;
        share = decodeSessionShare(await json(host, `/api/sessions/${encodeURIComponent(owner.id)}/share`, { method: 'POST' }));
        if (!share) throw new Error('Invalid share response');
        if (!current()) return; void refreshArtifacts(owner);
      }
      if (!current()) return;
      const base = share.url || location.origin + share.path;
      await copyTextToClipboard(`${base}?targetId=${encodeURIComponent(id)}`);
      if (!current()) return;
      button.classList.add('copied'); later(messageTimers, () => { if (owns(owner, host)) button.classList.remove('copied'); });
      setStatus('Message share link copied');
    } catch (error) { if (current()) setStatus('Share link failed: ' + errorMessage(error), 'error'); }
    finally { if (messageCopies.get(button) === token) messageCopies.delete(button); }
  }

  // Shared post-close handling (stats-modal close and the sidebar row ✕):
  // re-fetch both lists (the session just moved from active to previous) and,
  // when it was the selected session, re-select so the view flips to its
  // inactive state (resume bar).
  async function finishSessionClose(sessionId: string, host: string | null, owner: SelectionOwner | null) {
    if (disposed) return;
    if (!owner || sessionState.ownsSelection(owner)) setStatus('Session closed');
    await options.loadPrevious();
    if (!disposed && owner && sessionState.ownsSelection(owner) && owner.id === sessionId && owner.host === (host || null)) {
      await selectSession(sessionId, { host });
    }
  }

  // Session-process controls in the stats modal. Restart is advertised only for
  // a pi-dish-owned tmux pane or RPC child; the server replaces that exact
  // placement so startup-only CLI code/settings refresh without creating a new
  // tmux session or window.
  function renderCloseSection(owner: SelectionOwner, generation: number) {
    if (!ownsStatsModal(owner, generation) || !statsEndpoint) return;
    processEvents.abort(); processEvents = new AbortController();
    const endpoint = statsEndpoint;
    let busy = false;
    const listener = { signal: processEvents.signal };
    const sessionId = owner.id;
    const el = document.getElementById('statsClose');
    if (!el) return;
    const session = sessionState.findSession(sessionId, owner.host);
    if (!session?.isActive || !sessionSupports(session, 'close')) { el.remove(); return; }
    const host = owner.host;
    const detach = session.closeMode === 'client-only'; // Older fleet hosts still only detach Prime clients.
    const ownedAgent = session.closeMode === 'owned-agent';
    const restartable = record(session.capabilities) && session.capabilities.restart === true;
    el.innerHTML = '<div class="stats-share-title">Session process</div>' +
      '<div class="stats-share-body">' +
      (restartable ? '<button type="button" class="btn-small" id="sessionRestartBtn">Restart agent</button>' : '') +
      `<button type="button" class="btn-small btn-danger" id="sessionCloseBtn">${detach ? 'Detach client' : 'Close session'}</button>` +
      `<div class="stats-share-hint">${detach
        ? 'Disconnects this client. The logical agent continues independently.'
        : ownedAgent
          ? (restartable
            ? 'Restart stops this agent and its children, then resumes the root in the same pane. Close also removes the client pane. The transcript is kept; other root agents keep running.'
            : 'Stops this agent and its children, then closes its pi-dish-owned client pane. The transcript stays resumable.')
          : restartable
          ? 'Restarts the agent in its current pi-dish-owned pane or RPC slot. The transcript is kept.'
          : 'Shuts down this agent process. The transcript is kept and can be resumed.'}</div>` +
      '</div>';

    const closeBtn = el.querySelector<HTMLButtonElement>('#sessionCloseBtn')!;
    closeBtn.addEventListener('click', async () => {
      if (!ownsStatsModal(owner, generation) || busy) return;
      const warn = detach
        ? 'Detach this client? The logical agent will continue independently.'
        : ownedAgent
          ? 'Stop this agent and its children? Any work in progress will be aborted; the transcript stays resumable.'
          : sessionState.findSession(sessionId, host)?.turnInProgress
          ? 'A turn is in progress — closing will abort it. Close this session?'
          : 'Close this session? The agent process will shut down (the transcript stays resumable).';
      if (!confirm(warn) || !ownsStatsModal(owner, generation)) return;
      busy = true;
      closeBtn.disabled = true;
      closeBtn.textContent = detach ? 'Detaching…' : 'Closing…';
      try {
        await apiSend(endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/close`);
        if (!ownsStatsModal(owner, generation)) return;
        closeStatsModal();
        await finishSessionClose(sessionId, host, owner);
      } catch (e) {
        if (!ownsStatsModal(owner, generation)) return;
        busy = false; closeBtn.disabled = false;
        closeBtn.textContent = detach ? 'Detach client' : 'Close session';
        setStatus('Close failed: ' + errorMessage(e), 'error');
      }
    }, listener);

    const restartBtn = el.querySelector<HTMLButtonElement>('#sessionRestartBtn');
    if (!restartBtn) return;
    restartBtn.addEventListener('click', async () => {
      if (!ownsStatsModal(owner, generation) || busy) return;
      const active = sessionState.findSession(sessionId, host);
      const warn = ownedAgent
        ? 'Restart this agent? This stops the root and its children, aborting any work in progress, then resumes the root in the same pane. The transcript is kept; other root agents keep running.'
        : active?.turnInProgress
        ? 'A turn is in progress — restarting will abort it. Restart this agent?'
        : 'Restart this agent? The current process will stop, then the session will resume with updated CLI code and startup settings.';
      if (!confirm(warn) || !ownsStatsModal(owner, generation)) return;
      busy = true;
      closeBtn.disabled = true;
      restartBtn.disabled = true;
      restartBtn.textContent = 'Restarting…';
      setStatus('Restarting agent…', 'working');
      try {
        const data = await apiSend(endpoint, `/api/sessions/${encodeURIComponent(sessionId)}/restart`);
        if (!record(data) || typeof data.id !== 'string' || !data.id) throw new Error('Invalid restart response');
        if (ownsStatsModal(owner, generation)) closeStatsModal();
        if (owns(owner, endpoint)) setStatus('Agent restarted');
        await refreshSessions();
        if (owns(owner, endpoint) && record(data) && typeof data.id === 'string') {
          void selectSession(data.id, { host });
        }
      } catch (e) {
        if (ownsStatsModal(owner, generation)) closeStatsModal();
        await options.loadPrevious();
        if (owns(owner, endpoint)) {
          void selectSession(sessionId, { host });
          setStatus('Restart failed: ' + errorMessage(e), 'error');
        }
      }
    }, listener);
  }

  function closeStatsModal() {
    if (disposed) return;
    statsEvents.abort(); shareEvents.abort(); pagesEvents.abort(); processEvents.abort(); clearTimers(statsTimers);
    statsEndpoint = null; shareSequence++; pagesSequence++;
    statsModalGeneration += 1;
    statsModalOwner = null;
    element('statsModal').style.display = 'none';
  }

  async function loadPagesSection(owner: SelectionOwner, generation: number): Promise<void> {
    if (!ownsStatsModal(owner, generation) || !statsEndpoint) return;
    const host = statsEndpoint, sequence = ++pagesSequence;
    pagesEvents.abort(); pagesEvents = new AbortController();
    const current = () => sequence === pagesSequence && ownsStatsModal(owner, generation);
    const element = document.getElementById('statsPages'); if (!element) return;
    try {
      const pages = decodePublishedPages(await json(host, `/api/pages?sessionId=${encodeURIComponent(owner.id)}`));
      if (!current()) return;
      element.innerHTML = pages.length ? '<div class="stats-share-title">Published pages</div>' + pages.map(page => {
        const link = page.url || location.origin + page.path, label = page.title || page.root.split('/').pop();
        return `<div class="stats-page-row" data-token="${escapeHtml(page.token)}"><span class="stats-page-name" title="${escapeHtml(page.root)}">${escapeHtml(label)}${page.missing ? ' <span class="stats-page-missing">(file missing)</span>' : ''}</span><button type="button" class="stats-copy stats-share-link" data-copy="${escapeHtml(link)}" title="Click to copy">${escapeHtml(link)}</button><button type="button" class="btn-small btn-danger stats-page-revoke">Revoke</button></div>`;
      }).join('') : '';
      element.querySelectorAll<HTMLButtonElement>('.stats-page-revoke').forEach(button => {
        const token = button.closest<HTMLElement>('.stats-page-row')?.dataset.token; if (!token) return;
        button.addEventListener('click', async () => {
          if (!current() || button.disabled) return; button.disabled = true;
          try { await json(host, `/api/pages/${encodeURIComponent(token)}`, { method: 'DELETE' }); if (!current()) return; void loadPagesSection(owner, generation); void refreshArtifacts(owner); }
          catch (error) { if (current()) { button.disabled = false; setStatus('Failed to revoke: ' + errorMessage(error), 'error'); } }
        }, { signal: pagesEvents.signal });
      });
    } catch { if (current()) element.innerHTML = ''; }
  }

  // --- Shared artifacts (header 📦: everything published/shared from the
  // session in one place) ---
  // Pages the agent (or the file viewer's 🌐) published plus the session share
  // link. The badge count keeps them discoverable without opening the stats
  // modal; refreshed on session select, turn end (agents publish mid-turn),
  // and after any publish/revoke in the UI.
  let sessionArtifacts: { pages: readonly PublishedPage[]; share: SessionShare | null } = { pages: [], share: null };
  let artifactsSeq = 0; // drops stale responses on fast session switches

  async function refreshArtifacts(owner = sessionState.captureSelection()) {
    if (disposed || !owner || !sessionState.ownsSelection(owner)) return;
    const sessionId = owner.id;
    const host = endpoint(owner); if (!host) return;
    const seq = ++artifactsSeq;
    try {
      const [pagesRes, shareRes] = await Promise.all([
        apiFetch(host, `/api/pages?sessionId=${encodeURIComponent(sessionId)}`),
        apiFetch(host, `/api/sessions/${encodeURIComponent(sessionId)}/share`),
      ]);
      const pages: unknown = pagesRes.ok ? await pagesRes.json() : [];
      const share: unknown = (shareRes.ok && shareRes.status !== 404) ? await shareRes.json() : null;
      if (seq !== artifactsSeq || !owns(owner, host)) return;
      sessionArtifacts = { pages: decodePublishedPages(pages), share: decodeSessionShare(share) };
      artifactOwner = owner; artifactEndpoint = host;
      updateArtifactsBadge();
      if (element('artifactsModal').style.display !== 'none') renderArtifactsModal();
    } catch {}
  }

  function updateArtifactsBadge() {
    if (disposed) return;
    const n = sessionArtifacts.pages.length + (sessionArtifacts.share ? 1 : 0);
    const btn = document.getElementById('btnArtifacts');
    const row = document.getElementById('cpArtifactsRow');
    if (btn) {
      btn.style.display = n ? '' : 'none';
      element('artifactCount').textContent = String(n);
    }
    if (row) {
      row.style.display = n ? '' : 'none';
      element('artifactCountMobile').textContent = String(n);
    }
  }

  function openArtifactsModal() {
    if (disposed || !sessionState.currentSession) return;
    artifactGeneration++; element('artifactsModal').style.display = 'flex';
    renderArtifactsModal();
    refreshArtifacts();
  }

  function closeArtifactsModal() {
    if (disposed) return;
    artifactGeneration++; artifactEvents.abort();
    element('artifactsModal').style.display = 'none';
  }

  function renderArtifactsModal() {
    if (disposed || element('artifactsModal').style.display === 'none') return;
    artifactEvents.abort(); artifactEvents = new AbortController();
    const owner = artifactOwner, host = artifactEndpoint, generation = ++artifactGeneration;
    const current = () => generation === artifactGeneration && owns(owner, host) && element('artifactsModal').style.display !== 'none';
    const body = document.getElementById('artifactsBody');
    if (!body) return;
    const { pages, share } = owns(owner, host) ? sessionArtifacts : { pages: [], share: null };
    if (!pages.length && !share) {
      body.innerHTML = '<div class="stats-share-hint">Nothing shared from this session yet — published pages and share links show up here.</div>';
      return;
    }
    let html = '';
    if (pages.length) {
      html += '<div class="stats-share-title">Published pages</div>' + pages.map((p) => {
        const link = p.url || (location.origin + p.path);
        const label = p.title || p.root.split('/').pop();
        return `<div class="artifact-row">
          <a class="artifact-link" href="${escapeHtml(link)}" target="_blank" rel="noopener" title="${escapeHtml(p.root)}">${escapeHtml(label)}</a>
          ${p.missing ? '<span class="stats-page-missing">(file missing)</span>' : ''}
          <span class="artifact-meta">${escapeHtml(formatRelativeTime(p.createdAt))}</span>
          <button type="button" class="btn-icon artifact-copy" data-copy="${escapeHtml(link)}" title="Copy link">⧉</button>
          <button type="button" class="btn-small btn-danger artifact-revoke" data-token="${escapeHtml(p.token)}">Revoke</button>
        </div>`;
      }).join('');
    }
    if (share) {
      const link = share.url || (location.origin + share.path);
      html += '<div class="stats-share-title">Session share link</div>' +
        `<div class="artifact-row">
          <a class="artifact-link" href="${escapeHtml(link)}" target="_blank" rel="noopener">Read-only transcript</a>
          <span class="artifact-meta"></span>
          <button type="button" class="btn-icon artifact-copy" data-copy="${escapeHtml(link)}" title="Copy link">⧉</button>
        </div>`;
    }
    body.innerHTML = html;
    body.querySelectorAll<HTMLElement>('.artifact-copy').forEach(button => {
      const text = button.dataset.copy || '';
      button.addEventListener('click', () => {
        if (!current()) return;
        void copyTextToClipboard(text).then(() => { if (current()) setStatus('Link copied'); }, () => { if (current()) setStatus('Copy failed (clipboard blocked)', 'error'); });
      }, { signal: artifactEvents.signal });
    });
    body.querySelectorAll<HTMLButtonElement>('.artifact-revoke').forEach(button => {
      const token = button.dataset.token;
      button.addEventListener('click', async () => {
        if (!current() || !token || !owner || !host || button.disabled) return; button.disabled = true;
        try { await json(host, `/api/pages/${encodeURIComponent(token)}`, { method: 'DELETE' }); if (current()) await refreshArtifacts(owner); }
        catch (error) { if (current()) { button.disabled = false; setStatus('Failed to revoke: ' + errorMessage(error), 'error'); } }
      }, { signal: artifactEvents.signal });
    });
  }

  return { openStats: openStatsModal, closeStats: closeStatsModal, copyMessage: copyMessageShareLink, finishClose: finishSessionClose,
    openArtifacts: openArtifactsModal, closeArtifacts: closeArtifactsModal, refreshArtifacts, updateBadge: updateArtifactsBadge,
    get statsOwner() { return statsModalOwner; },
    resetArtifacts() { if (disposed) return; sessionArtifacts = { pages: [], share: null }; artifactOwner = null; artifactEndpoint = null; artifactsSeq++; artifactEvents.abort(); messageCopies = new WeakMap(); clearTimers(messageTimers); updateArtifactsBadge(); },
    dispose() { closeStatsModal(); closeArtifactsModal(); clearTimers(messageTimers); messageCopies = new WeakMap(); artifactsSeq++; disposed = true; },
  };
}
