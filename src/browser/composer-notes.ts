export function createComposerNotes(document: Document) {
  let disposed = false, events = new AbortController();
  function hide() { events.abort(); const element = document.getElementById('composerNote'); if (element) { element.style.display = 'none'; element.textContent = ''; } }
  function show(text: string) {
    if (disposed) return; const element = document.getElementById('composerNote'); if (!element) return;
    hide(); events = new AbortController(); const owned = events;
    const message = document.createElement('span'); message.className = 'composer-note-text'; message.textContent = text;
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'composer-note-dismiss'; dismiss.title = 'Dismiss'; dismiss.textContent = '✕';
    dismiss.addEventListener('click', () => { if (!owned.signal.aborted && element.contains(dismiss)) hide(); }, { signal: owned.signal });
    element.append(message, dismiss); element.style.display = '';
  }
  return { show, hide, dispose() { hide(); disposed = true; } };
}
