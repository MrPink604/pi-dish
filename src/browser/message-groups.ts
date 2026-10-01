/** The group skeleton (summary + body) is shared so eviction splitting and the grouping pass cannot drift apart. */
function createToolGroup(document: Document) {
  const group = document.createElement('details');
  group.className = 'tool-group';
  group.innerHTML = '<summary class="tool-group-header"><span class="tool-group-label"></span><span class="tool-group-preview"></span></summary><div class="tool-group-body"></div>';
  return group;
}

export function groupToolActivity(container: HTMLElement | null) {
  if (!container) return; const document = container.ownerDocument;
  // Eviction can leave only hidden index markers in a formerly visible group.
  for (const group of container.querySelectorAll<HTMLDetailsElement>(':scope > details.tool-group')) {
    const body = group.querySelector('.tool-group-body')!;
    if (!body.querySelector('[data-msg-index]:not([hidden])')) group.replaceWith(...body.childNodes);
  }
  const isToolNoise = (el: Element) =>
    el.matches('.message.tool-result[data-msg-index], .message.assistant.no-text[data-msg-index], [hidden][data-msg-index]');

  // Pass 1: wrap each maximal run of ungrouped tool activity.
  let run: Element[] = [];
  const wrapRun = () => {
    if (!run.length) return;
    // Keep hidden index markers in order without inventing a thinking-only
    // group when the entire run has no visible tool activity.
    if (run.every(el => el.hasAttribute('hidden'))) {
      const previous = run[0].previousElementSibling, next = run[run.length - 1].nextElementSibling;
      if (previous?.matches('details.tool-group')) previous.querySelector('.tool-group-body')!.append(...run);
      else if (next?.matches('details.tool-group')) next.querySelector('.tool-group-body')!.prepend(...run);
      run = []; return;
    }
    const group = createToolGroup(document);
    run[0].before(group);
    const body = group.querySelector('.tool-group-body')!;
    run.forEach(el => body.appendChild(el));
    run = [];
  };
  for (const child of Array.from(container.children)) {
    if (isToolNoise(child)) run.push(child);
    else wrapRun();
  }
  wrapRun();

  // Pass 2: merge adjacent groups (a turn split across pages/catch-ups).
  // The later group survives so an element being used as a scroll anchor
  // (loadOlderMessages) isn't removed from the DOM.
  container.querySelectorAll<HTMLDetailsElement>(':scope > details.tool-group').forEach(group => {
    const next = group.nextElementSibling;
    if (!next || !next.matches('details.tool-group')) return;
    next.querySelector('.tool-group-body')!.prepend(...group.querySelector('.tool-group-body')!.childNodes);
    if (group.open && next instanceof HTMLDetailsElement) next.open = true;
    group.remove();
  });

  container.querySelectorAll<HTMLDetailsElement>(':scope > details.tool-group').forEach(updateToolGroupSummary);
}

/**
 * Re-wrap a tool group whose indexed children are no longer contiguous.
 * Bounding the transcript evicts a middle range, and a gap that lands inside
 * a group cannot be marked there (gaps are top-level siblings), so the
 * surviving runs become separate groups and refreshPaging can place the gap
 * between them.
 */
export function splitToolGroupRanges(container: HTMLElement | null) {
  if (!container) return; const document = container.ownerDocument;
  for (const group of Array.from(container.querySelectorAll<HTMLDetailsElement>(':scope > details.tool-group'))) {
    const body = group.querySelector<HTMLElement>('.tool-group-body'); if (!body) continue;
    let active = group, activeBody = body, previous: number | null = null;
    for (const child of Array.from(body.children)) {
      const index = Number.parseInt((child as HTMLElement).dataset.msgIndex || '', 10);
      if (previous != null && Number.isFinite(index) && index > previous + 1) {
        const next = createToolGroup(document); next.open = group.open;
        active.after(next); active = next; activeBody = next.querySelector<HTMLElement>('.tool-group-body')!;
      }
      if (Number.isFinite(index)) previous = index;
      if (child.parentElement !== activeBody) activeBody.append(child);
    }
  }
}

export function updateToolGroupSummary(group: HTMLElement) {
  const calls = group.querySelectorAll('details.tool-call').length;
  const results = group.querySelectorAll('.message.tool-result').length;
  const n = Math.max(calls, results);
  const names = [...new Set(
    [...group.querySelectorAll('.tool-call-name')].map(el => (el.textContent || '').trim())
  )];
  group.querySelector('.tool-group-label')!.textContent =
    n ? `⚡ ${n} tool use${n === 1 ? '' : 's'}` : '🧠 thinking';
  group.querySelector('.tool-group-preview')!.textContent =
    names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '');
}

