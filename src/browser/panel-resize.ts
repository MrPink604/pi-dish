const SIDEBAR_WIDTH_KEY = 'pi-dish-sidebar-width';
export function clampSidebarWidth(px: number, viewportWidth: number): number {
  return Math.round(Math.min(Math.max(220, px), Math.max(220, viewportWidth * 0.5)));
}
export function clampTerminalHeight(px: number, parentHeight: number): number {
  return Math.min(Math.round(parentHeight * 0.8), Math.max(140, px));
}
export function createPanelResize(options: { document: Document; storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; fitTerminal: () => void }) {
  const { document, storage } = options, window = document.defaultView!;
  const events = new AbortController();
  const mounts = new Set<string>();
  const drags = new Set<() => void>();
  let disposed = false;
  function sidebarWidth(): void {
    if (disposed) return;
    const sidebar = document.getElementById('sidebar'); if (!sidebar) return;
    const saved = parseFloat(storage.getItem(SIDEBAR_WIDTH_KEY) || '');
    sidebar.style.width = Number.isFinite(saved) ? clampSidebarWidth(saved, window.innerWidth) + 'px' : '';
  }
  function terminalSize(panel: HTMLElement): void {
    if (disposed) return;
    const saved = parseFloat(storage.getItem('pi-dish-terminal-size') || '');
    if (Number.isFinite(saved)) panel.style.flexBasis = Math.min(80, Math.max(10, saved)) + '%';
  }
  function mount(kind: 'sidebar' | 'terminal'): void {
    if (disposed || mounts.has(kind)) return;
    const handle = document.getElementById(kind === 'sidebar' ? 'sidebarResizeHandle' : 'terminalResizeHandle');
    const panel = document.getElementById(kind === 'sidebar' ? 'sidebar' : 'terminalPanel');
    if (!handle || !panel) return;
    mounts.add(kind);
    if (kind === 'sidebar') {
      sidebarWidth();
      handle.addEventListener('dblclick', () => { storage.removeItem(SIDEBAR_WIDTH_KEY); panel.style.width = ''; options.fitTerminal(); }, { signal: events.signal });
    }
    let cancelDrag: (() => void) | null = null;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); cancelDrag?.();
      const startX = event.clientX, startY = event.clientY, startWidth = panel.offsetWidth, startHeight = panel.offsetHeight;
      const parentHeight = panel.parentElement?.clientHeight || 0;
      if (kind === 'terminal' && parentHeight <= 0) return;
      const dragEvents = new AbortController(), pointer = event.pointerId;
      handle.setPointerCapture(pointer); handle.classList.add('dragging');
      let active = true;
      const finish = (save: boolean) => {
        if (!active) return; active = false; dragEvents.abort(); drags.delete(cancel);
        cancelDrag = null; handle.classList.remove('dragging');
        if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
        if (!save || disposed) return;
        if (kind === 'sidebar') storage.setItem(SIDEBAR_WIDTH_KEY, String(panel.offsetWidth));
        else { const pct = (panel.offsetHeight / parentHeight * 100).toFixed(1); storage.setItem('pi-dish-terminal-size', pct); panel.style.flexBasis = pct + '%'; }
        options.fitTerminal();
      };
      const cancel = () => finish(false); cancelDrag = cancel; drags.add(cancel);
      handle.addEventListener('pointermove', move => {
        if (move.pointerId !== pointer) return;
        if (kind === 'sidebar') panel.style.width = clampSidebarWidth(startWidth + move.clientX - startX, window.innerWidth) + 'px';
        else { panel.style.flexBasis = clampTerminalHeight(startHeight + startY - move.clientY, parentHeight) + 'px'; options.fitTerminal(); }
      }, { signal: dragEvents.signal });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) handle.addEventListener(type, end => {
        if (end.pointerId === pointer) finish(true);
      }, { signal: dragEvents.signal });
    }, { signal: events.signal });
  }
  return { sidebarWidth, terminalSize, sidebar: () => mount('sidebar'), terminal: () => mount('terminal'),
    dispose() { disposed = true; events.abort(); for (const cancel of [...drags]) cancel(); mounts.clear(); } };
}
