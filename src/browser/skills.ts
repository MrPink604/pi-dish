import type { ApiRequest, HostEndpoint } from './api-client';
import type { SessionState } from './session-state';
import { escapeHtml, formatRelativeTime, shortCwd } from './helper-format';
import { record } from './helper-values';
import { decodeSkillDirectory, decodeSkillCoverage } from './skills-data';
import type { SkillDirectory, SkillRefine, SkillEntry, SkillCoverage } from './skills-data';
export interface SkillsHost extends HostEndpoint { readonly hostId: string | null }
export function createSkills(options: {
  root: HTMLElement; request: ApiRequest; self: () => SkillsHost; origin: () => string;
  sessionState: SessionState; loadPrevious: () => Promise<unknown>;
  selectSession: (id: string, options: { host: string | null }) => Promise<unknown>;
  closeOtherViews: () => void; refine: (value: { cwd: string; draft: string; host: string | null }) => void;
  copy: (text: string) => void; status: (message: string) => void;
}) {
  const document = options.root.ownerDocument, sessionState = options.sessionState;
  const element = <T extends HTMLElement = HTMLElement>(id: string) => {
    const value = document.getElementById(id); if (!value) throw new Error('Missing skills element: ' + id); return value as T;
  };
  let disposed = false;
  let viewHost: SkillsHost | null = null;
  let bodyEvents = new AbortController(), headerEvents = new AbortController();
  let indexingTimer: ReturnType<typeof setTimeout> | undefined, activationTimer: ReturnType<typeof setTimeout> | undefined;
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);
  function owns(seq = skillsSeq): boolean {
    const current = options.self();
    return seq === skillsSeq && isSkillsViewOpen() && !!viewHost && current.hostId === viewHost.hostId && current.base === viewHost.base && (current.token || '') === (viewHost.token || '');
  }
  function retireBody(): void { bodyEvents.abort(); bodyEvents = new AbortController(); }
  async function read(path: string): Promise<unknown> {
    const host = viewHost;
    if (!host) throw new Error('Skills host is no longer available');
    const response = await options.request(host, path);
    const data: unknown = await response.json();
    if (!response.ok) throw new Error(record(data) && typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
    return data;
  }
  // --- Skills view (main-pane takeover) ------------------------------------
  // Observational directory of discovered skills and their mined activation
  // coverage. Directory + an in-takeover detail page (never a modal). Every
  // token number is a chars/4 estimate; every usage number is inferred from
  // tool calls — badged accordingly, and quiet skills are warm-muted, never
  // alarm-colored. See TASKS/skills-view-phase1.md.
  let skillsData: SkillDirectory | null = null;        // GET /api/skills payload
  let skillsRefine: SkillRefine | null = null;      // refine config from the same payload
  let skillsSort = 'recent';
  let skillsFilter = '';
  let skillsDetailPath: string | null = null;  // absolute SKILL.md path when the detail is open
  let skillsDetail: SkillCoverage | null = null;      // GET /api/skills/coverage payload
  let skillsSeq = 0;

  function isSkillsViewOpen() {
    return !disposed && options.root.classList.contains('skills-open');
  }

  function openSkillsView() {
    if (disposed) return;
    closeSkillsView(); options.closeOtherViews();
    viewHost = Object.freeze({ ...options.self() });
    options.root.classList.add('skills-open');
    skillsDetailPath = null;
    loadSkillsDirectory();
  }

  function closeSkillsView() {
    if (disposed) return;
    ++skillsSeq; bodyEvents.abort(); headerEvents.abort();
    clearTimeout(indexingTimer); clearTimeout(activationTimer);
    options.root.classList.remove('skills-open');
  }

  function refreshSkillsView() {
    if (skillsDetailPath) openSkillDetail(skillsDetailPath, { force: true });
    else loadSkillsDirectory();
  }

  // Escape on the detail page steps back to the directory; on the directory it
  // closes the takeover. Wired into the global Escape handler.
  function skillsViewEscape() {
    if (skillsDetailPath) { backToSkillsDirectory(); return true; }
    closeSkillsView();
    return true;
  }

  function fmtTok(n: number) {
    n = Number(n) || 0;
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(n);
  }
  function fmtBytes(n: number) {
    n = Number(n) || 0;
    if (n >= 1024 * 1024) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
    return n + ' B';
  }
  function fmtEditedDate(ms: number) {
    if (!ms) return '—';
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // Single-hue sparkline: bars scaled to `maxPx`, zero weeks as --chart-other
  // stubs (never omitted). `pct` renders flex bars with % heights instead.
  function renderSpark(weeks: readonly number[], { maxPx = 22, cls = 'spark', pct = false } = {}) {
    const max = Math.max(1, ...weeks);
    const bars = weeks.map(w => {
      if (!w) return '<i class="z"></i>';
      if (pct) return `<i style="height:${Math.max(9, Math.round(w / max * 100))}%"></i>`;
      return `<i style="height:${Math.max(3, Math.round(w / max * maxPx))}px"></i>`;
    }).join('');
    return `<div class="${cls}">${bars}</div>`;
  }

  async function loadSkillsDirectory() {
    if (!owns() || skillsDetailPath) return;
    clearTimeout(indexingTimer); retireBody();
    const seq = ++skillsSeq;
    const body = element('skillsViewBody');
    renderSkillsHeader('directory');
    if (!body.childElementCount) body.innerHTML = '<div class="usage-state">Loading skills…</div>';
    else body.classList.add('usage-refreshing');
    try {
      const data = await read('/api/skills');
      if (!owns(seq)) return;
      const d = decodeSkillDirectory(data);
      if (!owns(seq) || skillsDetailPath) return;
      skillsData = d;
      skillsRefine = d.refine;
      renderSkillsDirectory(d);
      if (d.indexing) indexingTimer = setTimeout(() => { if (owns(seq) && !skillsDetailPath) void loadSkillsDirectory(); }, 1000);
    } catch (e) {
      if (!owns(seq)) return;
      body.classList.remove('usage-refreshing');
      body.innerHTML = `<div class="usage-state">Could not load skills: ${escapeHtml(message(e))}</div>`;
    }
  }

  function renderSkillsHeader(mode: 'directory' | 'detail', skill?: SkillEntry) {
    headerEvents.abort(); headerEvents = new AbortController();
    const seq = skillsSeq;
    const el = document.getElementById('skillsViewHeader');
    if (!el) return;
    if (mode === 'detail' && skill) {
      const chips = `<span class="chip ${skill.advertised ? 'adv' : ''}">${skill.advertised ? 'advertised' : 'manual only'}</span>` +
        `<span class="chip">${escapeHtml(skill.source)}</span>`;
      el.innerHTML = `
        <a class="skills-back" data-skills-action="back">‹ Skills</a>
        <h1 class="skills-detail-title">${escapeHtml(skill.name)} ${chips}</h1>
        <div class="skills-header-spacer"></div>
        <button class="btn refine-btn" data-skills-action="refine"${skillsDetail?.skill === skillsDetailPath ? '' : ' disabled'}>✎ Refine with an agent</button>
        <button class="btn-icon" data-skills-action="refresh" title="Refresh">⟳</button>
        <button class="btn-icon" data-skills-action="close" title="Close (Esc)">✕</button>`;
    } else {
      el.innerHTML = `
        <span class="usage-view-title">Skills</span>
        <span class="skills-scope">${escapeHtml(skillsData?.scope === 'all' ? 'all workspaces' : (skillsData?.scope || 'all workspaces'))}</span>
        <div class="skills-header-spacer"></div>
        <button class="btn-icon" data-skills-action="refresh" title="Refresh">⟳</button>
        <button class="btn-icon" data-skills-action="close" title="Close (Esc)">✕</button>`;
    }
    const actions: Record<string, () => unknown> = { back: backToSkillsDirectory, refine: startSkillRefine, refresh: refreshSkillsView, close: closeSkillsView };
    el.querySelectorAll<HTMLElement>('[data-skills-action]').forEach(button => button.addEventListener('click', () => {
      const action = button.dataset.skillsAction || '';
      if (owns(seq) && Object.hasOwn(actions, action)) actions[action]();
    }, { signal: headerEvents.signal }));

  }

  function sortedSkills(d: SkillDirectory) {
    let list = d.skills.slice();
    const q = skillsFilter.trim().toLowerCase();
    if (q) list = list.filter(s =>
      s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q) ||
      s.filePath.toLowerCase().includes(q));
    const byRecent = (a: SkillEntry, b: SkillEntry) => (b.usage.lastUsedTs || 0) - (a.usage.lastUsedTs || 0);
    const comparisons: Record<string, (a: SkillEntry, b: SkillEntry) => number> = {
      recent: byRecent,
      most: (a, b) => b.usage.count30d - a.usage.count30d || byRecent(a, b),
      least: (a, b) => a.usage.count30d - b.usage.count30d || byRecent(a, b),
      largest: (a, b) => b.bodyTokensEst - a.bodyTokensEst || byRecent(a, b),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return list.sort(Object.hasOwn(comparisons, skillsSort) ? comparisons[skillsSort] : byRecent);
  }

  const STALE_MS = 60 * 86400000;

  function renderSkillsDirectory(d: SkillDirectory) {
    if (!owns() || skillsDetailPath) return;
    retireBody(); const seq = skillsSeq;
    const body = element('skillsViewBody');
    body.classList.remove('usage-refreshing');
    const s = d.summary;
    const now = Date.now();
    const sortOpts = [['recent', 'Recently used'], ['most', 'Most used (30d)'], ['least', 'Least used'], ['largest', 'Largest'], ['name', 'Name']]
      .map(([v, l]) => `<option value="${v}"${skillsSort === v ? ' selected' : ''}>${l}</option>`).join('');

    const rows = sortedSkills(d).map(sk => {
      const u = sk.usage;
      const last = u.lastUsedTs ? formatRelativeTime(u.lastUsedTs) : '—';
      const stale = u.lastUsedTs == null || (now - u.lastUsedTs) > STALE_MS;
      const manual = sk.advertised ? '' : '<span class="manual">manual</span>';
      return `<div class="sk-row" data-skill="${escapeHtml(sk.skill)}">
        <div><div class="sk-name">${escapeHtml(sk.name)}${manual}</div><div class="sk-desc">${escapeHtml(sk.description || '')}</div></div>
        <div class="src">${escapeHtml(sk.source)}</div>
        <div class="tok">${fmtTok(sk.bodyTokensEst)}</div>
        ${renderSpark(u.weeks12)}
        <div class="num">${u.count30d}</div>
        <div class="last${stale ? ' stale' : ''}">${escapeHtml(last)}</div>
      </div>`;
    }).join('');

    body.innerHTML = `
      <div class="sk-summary">
        <div class="stat"><b>${s.discovered}</b><span>discovered</span></div>
        <div class="stat"><b>${s.advertised}</b><span>advertised · catalog ~${fmtTok(s.catalogTokensEst)} tok est</span></div>
        <div class="stat"><b>${s.activations30d}</b><span>activations · 30d</span></div>
        <div class="stat"><b>${s.quiet60d}</b><span>quiet &gt; 60d</span></div>
        <span class="badge-inferred" title="Usage is inferred from mined read/bash tool calls, not telemetry">inferred from tool calls</span>
      </div>
      <div class="sk-controls">
        <input id="skillsFilterInput" placeholder="Filter skills…" value="${escapeHtml(skillsFilter)}">
        <select id="skillsSortSelect">${sortOpts}</select>
      </div>
      <div class="sk-list">
        <div class="sk-colhead">
          <div>Skill</div><div>Source</div><div class="num">~Tok est</div><div>12 weeks</div><div class="num">30d</div><div style="text-align:right">Last used</div>
        </div>
        ${rows || '<div class="usage-state">No skills match.</div>'}
      </div>
      <div class="sk-foot">GET /api/skills · GET /api/skills/activations — NDJSON, filters: skill, since, cwd, kind</div>`;

    const filt = element<HTMLInputElement>('skillsFilterInput');
    filt.addEventListener('input', () => { if (!owns(seq)) return; skillsFilter = filt.value; renderSkillsDirectory(d); }, { signal: bodyEvents.signal });
    // keep focus/caret after the re-render
    filt.focus(); filt.setSelectionRange(filt.value.length, filt.value.length);
    const sort = element<HTMLSelectElement>('skillsSortSelect');
    sort.addEventListener('change', () => { if (!owns(seq)) return; skillsSort = sort.value; renderSkillsDirectory(d); }, { signal: bodyEvents.signal });
    body.querySelectorAll<HTMLElement>('.sk-row').forEach(row => row.addEventListener('click', () => {
      if (owns(seq) && row.dataset.skill) void openSkillDetail(row.dataset.skill);
    }, { signal: bodyEvents.signal }));
  }

  async function openSkillDetail(skillPath: string, { force = false } = {}) {
    if (!owns()) return;
    clearTimeout(indexingTimer); retireBody();
    const seq = ++skillsSeq;
    skillsDetailPath = skillPath;
    const skill = (skillsData?.skills || []).find(s => s.skill === skillPath);
    renderSkillsHeader('detail', skill);
    const body = element('skillsViewBody');
    body.classList.remove('usage-refreshing');
    if (force || !skillsDetail || skillsDetail.skill !== skillPath) {
      body.innerHTML = '<div class="usage-state">Loading coverage…</div>';
    }
    try {
      const data = await read('/api/skills/coverage?skill=' + encodeURIComponent(skillPath));
      if (!owns(seq)) return;
      const cov = decodeSkillCoverage(data);
      if (cov.skill !== skillPath) throw new Error('Coverage belongs to another skill');
      if (!owns(seq) || skillsDetailPath !== skillPath) return;
      skillsDetail = cov;
      renderSkillsHeader('detail', skill);
      renderSkillDetail(skill, cov);
    } catch (e) {
      if (!owns(seq) || skillsDetailPath !== skillPath) return;
      body.innerHTML = `<div class="usage-state">Could not load coverage: ${escapeHtml(message(e))}</div>`;
    }
  }

  function backToSkillsDirectory() {
    if (!owns()) return;
    skillsSeq++; clearTimeout(indexingTimer); retireBody();
    skillsDetailPath = null;
    skillsDetail = null;
    renderSkillsHeader('directory');
    if (skillsData) renderSkillsDirectory(skillsData);
    else loadSkillsDirectory();
  }

  // Line-heat bucket from a line's read count relative to the mapped-read total.
  function heatClass(hits: number, numMapped: number) {
    if (!hits) return 'h0';
    const r = hits / Math.max(1, numMapped);
    if (r >= 0.75) return 'h12';
    if (r >= 0.4) return 'h9';
    return 'h4';
  }

  function renderSkillDetail(skill: SkillEntry | undefined, cov: SkillCoverage) {
    if (!owns() || skillsDetailPath !== cov.skill) return;
    retireBody(); const seq = skillsSeq;
    const body = element('skillsViewBody');
    const u = skill?.usage;

    // Coverage centrepiece.
    let coverageHtml;
    if (cov.numMapped === 0) {
      coverageHtml = `<div class="cov-cap">No ranged reads recorded since this file was last edited${cov.excludedBeforeMtime ? ` (${cov.excludedBeforeMtime} older read${cov.excludedBeforeMtime === 1 ? '' : 's'} predate it)` : ''}.</div>`;
    } else if (cov.flatFullRead) {
      coverageHtml = `<div class="cov-flat">This skill is short enough that every one of the last
        ${cov.numMapped} read${cov.numMapped === 1 ? '' : 's'} loaded it in full — nothing has been
        skipped, so there is no partial-coverage map to show.</div>`;
    } else {
      const secRows = cov.sections.map((sec, i) => {
        const pct = Math.round(sec.fraction * 100);
        const cold = sec.neverRead ? ' cold' : '';
        const never = sec.neverRead ? '<span class="never">never read</span>' : '';
        const heads = escapeHtml(sec.heading === '(intro)' ? '(intro)' : sec.heading);
        return `<div class="sec-row${cold}" data-sec="${i}">
            <span class="sec-name">${heads} <span class="lines">${sec.startLine}–${sec.endLine}</span>${never}</span>
            <div class="cov-bar">${sec.reads ? `<i style="width:${pct}%"></i>` : ''}</div>
            <span class="sec-frac">${sec.reads}/${cov.numMapped}</span>
          </div>
          <div class="sec-open" id="skSecOpen${i}" style="display:none"></div>`;
      }).join('');
      coverageHtml = `
        <div class="cov-headline"><b>~${fmtTok(cov.unreadTokensEst)} tok</b> (est) never entered context across the last ${cov.numMapped} read${cov.numMapped === 1 ? '' : 's'}</div>
        <div class="cov-cap">${cov.numMapped} ranged read${cov.numMapped === 1 ? '' : 's'} mapped · ${cov.targetedTouches} targeted access${cov.targetedTouches === 1 ? '' : 'es'} (counted as touches, not mapped)${cov.excludedBeforeMtime ? ` · ${cov.excludedBeforeMtime} older read${cov.excludedBeforeMtime === 1 ? '' : 's'} predate this version` : ''}</div>
        ${secRows}
        <div class="d-note">Coverage maps ranged reads against the current file version only —
          activations before the last edit count toward totals but aren't mapped. A short skill
          that's always read in full shows a single line here instead of a map.</div>`;
    }

    const kinds = cov.kindSplit || {};
    const wsLine = u?.topCwd
      ? `Used in ${cov.cwdCount || u.cwdCount || 1} workspace${(cov.cwdCount || u.cwdCount || 1) === 1 ? '' : 's'}, mostly <span class="mono">${escapeHtml(shortCwd(cov.topCwd))}</span>`
      : 'No workspace activity recorded yet';
    let latestHtml = '';
    if (cov.latest && cov.latest.sessionId) {
      const label = cov.latest.name || 'session';
      latestHtml = `<div class="latest"><a class="skill-activation">latest activation: ${escapeHtml(label)} →</a>
        <span>${formatRelativeTime(cov.latest.ts)}${cov.latest.model ? ' · ' + escapeHtml(cov.latest.model) : ''}</span></div>`;
    }
    const apiUrl = options.origin() + '/api/skills/activations?skill=' + encodeURIComponent(skill ? skill.skill : cov.skill);
    const covUrl = options.origin() + '/api/skills/coverage?skill=' + encodeURIComponent(skill ? skill.skill : cov.skill);

    body.innerHTML = `<div class="skills-detail-wrap"><div class="cols">
      <div class="main-col">
        <div class="d-path" data-path="${escapeHtml(cov.skill)}" title="Copy path">${escapeHtml(cov.skill)}</div>
        <div class="d-meta">
          body <b>${fmtBytes(skill ? skill.bodyBytes : 0)}</b> · <b>~${fmtTok(skill ? skill.bodyTokensEst : 0)} tok</b> <span class="badge-inferred">est</span>
          ${skill && skill.advertised ? `&nbsp;·&nbsp; catalog entry <b>~${fmtTok(skill.catalogTokensEst)} tok</b> <span class="badge-inferred">est</span>` : ''}
          &nbsp;·&nbsp; last edited <b>${fmtEditedDate(cov.mtimeMs)}</b>
        </div>
        <div class="d-sec">Read coverage · since last edit <span class="badge-inferred">inferred</span></div>
        ${coverageHtml}
      </div>
      <div class="side-col">
        <div class="d-sec">Activity · 26 weeks <span class="badge-inferred">inferred</span></div>
        ${renderSpark(cov.weeks26, { cls: 'spark-lg', pct: true })}
        <div class="spark-cap"><span>${cov.weeks26.length}w ago</span><span>peak ${Math.max(0, ...cov.weeks26)}/wk</span><span>now</span></div>

        <div class="d-sec">Usage</div>
        <div class="kind-split">
          <div><b>${kinds.read || 0}</b>auto reads</div>
          <div><b>${kinds.explicit || 0}</b>explicit</div>
          <div><b>${cov.sessionCount || 0}</b>sessions</div>
        </div>
        <div class="ws-line">${wsLine}</div>
        ${latestHtml}

        <div class="d-sec">The primitive</div>
        <div class="api-box" data-copy="${escapeHtml(apiUrl)}"><span class="copy-hint">⧉</span><span class="c"># activations, NDJSON</span>
  ${escapeHtml(apiUrl)}

  <span class="c"># current coverage rollup</span>
  ${escapeHtml(covUrl)}</div>
        <div class="d-note">The ✎ button opens a new session with a drafted prompt carrying this
          evidence (path, stats, cold sections) — the refinement methodology itself is pluggable.</div>
      </div>
    </div></div>`;

    body.querySelector('.d-path')?.addEventListener('click', () => {
      if (!owns(seq)) return; options.copy(cov.skill); options.status('Skill path copied');
    }, { signal: bodyEvents.signal });
    body.querySelector('.api-box')?.addEventListener('click', () => {
      if (!owns(seq)) return; options.copy(apiUrl); options.status('Activations URL copied');
    }, { signal: bodyEvents.signal });
    body.querySelector('.skill-activation')?.addEventListener('click', () => {
      if (owns(seq) && cov.latest) void openSkillActivation(cov.latest.sessionId, cov.latest.entryId);
    }, { signal: bodyEvents.signal });
    // Section expand → line-level shading.
    body.querySelectorAll<HTMLElement>('.sec-row[data-sec]').forEach(row => {
      row.addEventListener('click', () => {
        if (!owns(seq)) return;
        const i = Number(row.dataset.sec);
        const open = document.getElementById('skSecOpen' + i);
        if (!open) return;
        if (open.style.display !== 'none') { open.style.display = 'none'; open.innerHTML = ''; return; }
        const sec = cov.sections[i];
        open.innerHTML = sec.lines.map(ln =>
          `<div class="ln ${heatClass(ln.hits, cov.numMapped)}"><span class="g"></span><span class="t">${escapeHtml(ln.text || ' ')}</span></div>`).join('');
        open.style.display = '';
      }, { signal: bodyEvents.signal });
    });
  }

  // The ✎ launcher: prefill the new-session takeover with the skill dir as cwd
  // and an evidence-bundle draft. Never auto-sends — the user reviews the draft
  // in the composer after the session spawns.
  function startSkillRefine() {
    if (!owns() || !viewHost) return;
    const skill = (skillsData?.skills || []).find(s => s.skill === skillsDetailPath);
    if (!skill || !skillsDetail || skillsDetail.skill !== skillsDetailPath) return;
    const draft = buildRefineDraft(skill, skillsDetail, skillsRefine || { mode: 'default', discovered: false, skillName: '', mdPath: '' });
    const cwd = skill.baseDir || skill.filePath.replace(/\/SKILL\.md$/, '');
    closeSkillsView();
    options.refine({ cwd, draft, host: viewHost.hostId });
  }

  function buildRefineDraft(skill: SkillEntry, cov: SkillCoverage, refine: SkillRefine) {
    const u = skill.usage || {};
    const lead = [];
    const usesSkillLead = refine.mode === 'skill' || (refine.mode === 'default' && refine.discovered);
    if (usesSkillLead) lead.push('/skill:' + refine.skillName, '');
    const cold = (cov.sections || []).filter(s => s.neverRead).map(s => s.heading);
    const parts = [
      'Help me refine this skill based on how it is actually being used.',
      '',
      'Skill: ' + skill.filePath,
      'Source: ' + skill.source + (skill.advertised ? ' · advertised' : ' · manual only'),
      'Body: ' + fmtBytes(skill.bodyBytes) + ' · ~' + skill.bodyTokensEst + ' tok (est)',
      'Usage (inferred from tool calls): ' + (u.total || 0) + ' activations, ' + (u.count30d || 0) +
        ' in the last 30d, across ' + (u.sessionCount || 0) + ' session(s); last used ' +
        (u.lastUsedTs ? formatRelativeTime(u.lastUsedTs) : 'never'),
      '~' + cov.unreadTokensEst + ' tok (est) never entered context across the last ' + cov.numMapped + ' mapped read(s).',
    ];
    if (cold.length) parts.push('Sections never read since the last edit: ' + cold.join('; '));
    parts.push(
      'Coverage detail: ' + options.origin() + '/api/skills/coverage?skill=' + encodeURIComponent(skill.filePath),
      'Raw activations (NDJSON): ' + options.origin() + '/api/skills/activations?skill=' + encodeURIComponent(skill.filePath),
      '');
    if (!usesSkillLead) {
      const ref = refine.mdPath || (refine.mode === 'path' ? refine.mdPath : null);
      if (ref) parts.push('Read ' + ref + ' and follow its methodology.');
    }
    parts.push('Note: read-coverage is not the same as adherence — ground-truth any cold section against a recent transcript before trimming it.');
    return lead.join('\n') + parts.join('\n');
  }

  // "latest activation →": select the session and best-effort scroll to the
  // activating entry (the per-message deep-link machinery keys on entry id).
  async function openSkillActivation(id: string, entryId: string): Promise<void> {
    if (!owns() || !viewHost) return;
    const endpoint = viewHost;
    closeSkillsView();
    const navigation = skillsSeq;
    const current = () => !disposed && navigation === skillsSeq && options.self().hostId === endpoint.hostId && options.self().base === endpoint.base && (options.self().token || '') === (endpoint.token || '');
    if (!sessionState.findSession(id, endpoint.hostId)) await options.loadPrevious();
    if (!current() || !sessionState.findSession(id, endpoint.hostId)) return;
    const selecting = options.selectSession(id, { host: endpoint.hostId });
    const owner = sessionState.captureSelection(), selectedView = skillsSeq;
    await selecting;
    if (!entryId || !owner || !sessionState.ownsSelection(owner) || owner.id !== id || owner.host !== endpoint.hostId) return;
    activationTimer = setTimeout(() => {
      if (disposed || selectedView !== skillsSeq || !sessionState.ownsSelection(owner)) return;
      const el = document.querySelector(`[data-entry-id="${CSS.escape(entryId)}"]`);
      const msg = el?.closest('.message');
      if (msg) { msg.scrollIntoView({ block: 'center' }); msg.classList.add('search-current'); }
    }, 400);
  }

  return { open: openSkillsView, close: closeSkillsView, isOpen: isSkillsViewOpen, refresh: refreshSkillsView,
    escape: skillsViewEscape, load: loadSkillsDirectory, detail: openSkillDetail, back: backToSkillsDirectory,
    refine: startSkillRefine, activation: openSkillActivation,
    dispose() { closeSkillsView(); disposed = true; },
  };
}
