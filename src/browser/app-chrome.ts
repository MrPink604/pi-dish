/** Page chrome owns viewport following, focus preference and mobile-panel listeners. */
export function createAppChrome(options: { document: Document; storage: Pick<Storage, 'getItem' | 'setItem'>; older: (container: HTMLElement) => unknown }) {
  const { document, storage } = options, messages = document.getElementById('messages')!;
  const lifetime = new AbortController(); let panelEvents = new AbortController();
  let following = false, focus = false, panelOpen = false, mounted = false, disposed = false, panelGeneration = 0;
  let panelTimer: ReturnType<typeof setTimeout> | null = null;
  function pinned(container: HTMLElement) { return following || container.scrollHeight - container.scrollTop - container.clientHeight < 80; }
  function scroll(container: HTMLElement) { if (disposed) return; container.scrollTop = container.scrollHeight; jump(container); }
  function jump(container: HTMLElement) {
    if (disposed) return; let button = document.getElementById('jumpToBottom');
    if (pinned(container)) { if (button) button.style.display = 'none'; return; }
    if (!button) {
      button = document.createElement('button'); button.id = 'jumpToBottom'; button.className = 'jump-to-bottom'; button.textContent = '↓'; button.title = 'Jump to latest';
      button.addEventListener('click', () => { following = true; scroll(messages); }, { signal: lifetime.signal });
      (document.getElementById('sessionView') || document.body).append(button);
    }
    button.style.display = '';
  }
  function setFocus(on: boolean) {
    if (disposed) return; focus = !!on; storage.setItem('pi-dish-focus', focus ? '1' : '0'); messages.classList.toggle('focus-mode', focus);
    for (const id of ['btnFocus', 'btnFocusMobile']) document.getElementById(id)?.classList.toggle('active', focus);
    const state = document.getElementById('focusModeState'); if (state) state.textContent = focus ? 'on' : 'off';
  }
  function toggleFocus() { setFocus(!focus); if (pinned(messages)) scroll(messages); }
  function closePanel() {
    panelGeneration++; panelOpen = false; panelEvents.abort(); if (panelTimer) clearTimeout(panelTimer); panelTimer = null;
    document.getElementById('controlPanel')?.classList.remove('open'); document.getElementById('btnPanel')?.classList.remove('active');
  }
  function openPanel() {
    if (disposed) return; closePanel(); panelOpen = true; const generation = panelGeneration; panelEvents = new AbortController();
    document.getElementById('controlPanel')?.classList.add('open'); document.getElementById('btnPanel')?.classList.add('active');
    panelTimer = setTimeout(() => {
      panelTimer = null; if (disposed || !panelOpen || generation !== panelGeneration) return;
      document.addEventListener('click', event => {
        if (disposed || !panelOpen || generation !== panelGeneration) return; const target = event.target instanceof Node ? event.target : null;
        const inside = !document.body.contains(target) || ['controlPanel', 'btnPanel', 'modelDropdown', 'thinkingDropdown'].some(id => document.getElementById(id)?.contains(target));
        if (!inside) closePanel();
      }, { signal: panelEvents.signal });
    }, 0);
  }
  function stopFollowing() { following = false; }
  function mount() {
    if (disposed || mounted) return; mounted = true; const { signal } = lifetime;
    messages.addEventListener('scroll', () => { jump(messages); options.older(messages); }, { passive: true, signal });
    messages.addEventListener('wheel', event => { stopFollowing(); if (event.deltaY < 0) options.older(messages); }, { passive: true, signal });
    messages.addEventListener('touchmove', () => { stopFollowing(); options.older(messages); }, { passive: true, signal });
    messages.addEventListener('mousedown', stopFollowing, { passive: true, signal });
  }
  return { pinned, scroll, jump, setFocus, toggleFocus, closePanel, openPanel, togglePanel() { if (panelOpen) closePanel(); else openPanel(); }, mount,
    follow() { if (!disposed) following = true; }, stopFollowing, get following() { return following; }, get focus() { return focus; }, get panelOpen() { return panelOpen; },
    dispose() { if (disposed) return; closePanel(); disposed = true; lifetime.abort(); },
  };
}
