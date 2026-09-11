export function groupToolActivity(container: HTMLElement | null) {
  if (!container) return; const document = container.ownerDocument;
  const isToolNoise = (el: Element) =>
    el.matches('.message.tool-result[data-msg-index], .message.assistant.no-text[data-msg-index]');

  // Pass 1: wrap each maximal run of ungrouped tool activity.
  let run: Element[] = [];
  const wrapRun = () => {
    if (!run.length) return;
    const group = document.createElement('details');
    group.className = 'tool-group';
    group.innerHTML = '<summary class="tool-group-header"><span class="tool-group-label"></span><span class="tool-group-preview"></span></summary><div class="tool-group-body"></div>';
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

