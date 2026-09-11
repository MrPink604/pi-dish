import type { SessionState, SelectionOwner } from './session-state';
import { escapeHtml } from './helper-format';
import { sessionRefKey } from './helper-identity';
export function createExtensionDisplay(options: { document: Document; sessionState: SessionState; storage: Pick<Storage, 'getItem' | 'setItem'> }) {
  const { document, sessionState, storage } = options;
  type Timer = ReturnType<typeof setTimeout>;
  interface Widget { el: HTMLElement; collapsed: boolean; timer: Timer | null; events: AbortController; owner: SelectionOwner | null }
  interface Status { el: HTMLElement; timer: Timer | null }
  const widgets = new Map<string, Widget>(), statuses = new Map<string, Status>(), collapsed = new Map<string, boolean>();
  const toasts = new Set<HTMLElement>(), toastTimers = new Set<Timer>(), events = new AbortController();
  let disposed = false, preferenceApplied = false, observer: ResizeObserver | null = null;
  const cancel = (timer: Timer | null) => { if (timer !== null) clearTimeout(timer); };
  const current = (owner: SelectionOwner | null) => !disposed && sessionState.ownsSelection(owner);
  function later(callback: () => void, delay: number) { const timer = setTimeout(() => { toastTimers.delete(timer); if (!disposed) callback(); }, delay); toastTimers.add(timer); return timer; }
  function toast(message: string, type: 'info' | 'warning' | 'error') {
    if (disposed) return;
    let root = document.getElementById('extUiToasts');
    if (!root) { root = document.createElement('div'); root.id = 'extUiToasts'; root.className = 'ext-ui-toasts'; document.body.append(root); }
    const node = document.createElement('div'); node.className = 'ext-ui-toast ' + type;
    const icons = { info: 'ℹ', warning: '⚠', error: '✖' };
    node.innerHTML = `<span class="ext-ui-toast-icon">${icons[type]}</span><span class="ext-ui-toast-body">${escapeHtml(message)}</span><button class="ext-ui-toast-close" title="Dismiss">×</button>`;
    toasts.add(node); root.append(node);
    let hiding = false;
    const hide = () => { if (disposed || hiding || !toasts.has(node)) return; hiding = true; node.classList.add('hiding'); later(() => { node.remove(); toasts.delete(node); }, 200); };
    node.querySelector('button')!.addEventListener('click', hide, { signal: events.signal });
    if (type === 'info') later(hide, 6000);
  }
  function widget(key: string, lines: readonly string[], placement: string) {
    if (disposed) return;
    let entry = widgets.get(key);
    if (entry && !entry.el.isConnected) { cancel(entry.timer); entry.events.abort(); widgets.delete(key); entry = undefined; }
    if (!lines.length) {
      if (!entry) return;
      cancel(entry.timer); const retained = entry;
      retained.timer = setTimeout(() => {
        if (disposed || widgets.get(key) !== retained) return;
        retained.el.classList.add('hidden');
        retained.timer = setTimeout(() => {
          if (disposed || widgets.get(key) !== retained) return;
          retained.timer = null; retained.events.abort(); retained.el.remove(); widgets.delete(key);
        }, 200);
      }, 500); return;
    }
    if (entry) { cancel(entry.timer); entry.timer = null; }
    const owner = sessionState.captureSelection(), collapsedKey = sessionRefKey(owner) + '|' + key;
    if (!entry) {
      const el = document.createElement('div'); el.className = 'ext-ui-widget'; el.dataset.widgetKey = key;
      entry = { el, collapsed: collapsed.get(collapsedKey) || false, timer: null, events: new AbortController(), owner };
      el.classList.toggle('collapsed', entry.collapsed);
      el.innerHTML = `<div class="ext-ui-widget-header"><span class="ext-ui-widget-label">${escapeHtml(key)}</span><span class="ext-ui-widget-toggle">▼</span></div><pre class="ext-ui-widget-body"></pre>`;
      const retained = entry;
      el.querySelector('.ext-ui-widget-header')!.addEventListener('click', () => {
        if (!current(retained.owner) || widgets.get(key) !== retained || !el.isConnected) return;
        retained.collapsed = el.classList.toggle('collapsed'); collapsed.set(collapsedKey, retained.collapsed);
      }, { signal: entry.events.signal });
      const input = document.querySelector('.input-area'), textarea = document.getElementById('promptInput');
      if (placement === 'belowEditor' && input && textarea) input.insertBefore(el, textarea.nextSibling);
      else if (input?.parentNode) input.parentNode.insertBefore(el, input);
      else document.getElementById('messages')?.insertAdjacentElement('beforebegin', el);
      widgets.set(key, entry);
    }
    entry.el.classList.remove('hidden');
    const body = entry.el.querySelector('.ext-ui-widget-body')!, text = lines.join('\n');
    if (body.textContent !== text) body.textContent = text;
  }
  function measure() {
    if (disposed) return;
    const row = document.getElementById('extUiStatuses'), items = document.getElementById('extUiStatusItems'), toggle = document.getElementById('extUiStatusToggle');
    if (!row || !items || !toggle) return;
    const clipped = [...items.children].some(el => el.scrollWidth > el.clientWidth + 1);
    toggle.style.display = !row.classList.contains('collapsed') || clipped ? '' : 'none';
  }
  function sync() {
    if (disposed) return;
    const row = document.getElementById('extUiStatuses'); if (!row) return;
    if (!preferenceApplied) { preferenceApplied = true; let open = false; try { open = storage.getItem('pi-dish-ext-status-open') === '1'; } catch {} if (open) toggleStatus(); }
    const items = document.getElementById('extUiStatusItems'); row.style.display = items?.children.length ? '' : 'none'; measure();
    if (!observer && items && typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(measure); observer.observe(items); }
  }
  function toggleStatus() {
    if (disposed) return;
    const row = document.getElementById('extUiStatuses'); if (!row) return;
    const isCollapsed = row.classList.toggle('collapsed'), toggle = document.getElementById('extUiStatusToggle');
    if (toggle) { toggle.setAttribute('aria-expanded', String(!isCollapsed)); toggle.title = isCollapsed ? 'Show full status' : 'Collapse status'; }
    try { storage.setItem('pi-dish-ext-status-open', isCollapsed ? '0' : '1'); } catch {} sync();
  }
  document.getElementById('extUiStatusToggle')?.addEventListener('click', toggleStatus, { signal: events.signal });
  function status(key: string, text: string) {
    if (disposed) return;
    const items = document.getElementById('extUiStatusItems'); if (!items) return;
    let entry = statuses.get(key);
    if (entry && !entry.el.isConnected) { cancel(entry.timer); statuses.delete(key); entry = undefined; }
    if (!text) {
      if (!entry) { sync(); return; }
      cancel(entry.timer); const retained = entry;
      retained.timer = setTimeout(() => { if (disposed || statuses.get(key) !== retained) return; retained.el.remove(); statuses.delete(key); sync(); }, 500); return;
    }
    if (entry) { cancel(entry.timer); entry.timer = null; }
    else { const el = document.createElement('span'); el.className = 'ext-ui-status-badge'; el.dataset.statusKey = key; items.append(el); entry = { el, timer: null }; statuses.set(key, entry); }
    if (entry.el.textContent !== text) entry.el.textContent = text;
    const title = `${text}\n(status from ${key})`; if (entry.el.title !== title) entry.el.title = title; sync();
  }
  function clear() {
    for (const entry of widgets.values()) { cancel(entry.timer); entry.events.abort(); entry.el.remove(); } widgets.clear();
    for (const entry of statuses.values()) { cancel(entry.timer); entry.el.remove(); } statuses.clear(); sync();
  }
  return { toast, widget, status, clear, toggleStatus,
    dispose() { clear(); disposed = true; events.abort(); observer?.disconnect(); observer = null; for (const timer of toastTimers) clearTimeout(timer); toastTimers.clear(); for (const node of toasts) node.remove(); toasts.clear(); collapsed.clear(); },
  };
}
