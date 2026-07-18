/* Anchored comments for pi-dish published pages.
 *
 * Injected only when a page is viewed through the main pi-dish server.  It
 * lives in a shadow root so generated artifacts cannot accidentally restyle
 * the controls (and these controls cannot restyle the artifact).
 */
(() => {
  const script = document.currentScript;
  const pageToken = script?.dataset.pageToken;
  if (!pageToken || window.top !== window.self) return;

  let selected = null;
  let selectedRange = null;
  let draftVersion = 0;
  const host = document.createElement('div');
  host.id = 'pi-dish-comment-layer';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      * { box-sizing:border-box; font-family:ui-sans-serif,system-ui,sans-serif }
      button,textarea { font:inherit }
      #card { display:none; position:fixed; width:min(380px,calc(100vw - 16px));
        max-height:calc(100dvh - 16px); overflow-y:auto; pointer-events:auto;
        color:CanvasText; background:Canvas; border:1px solid GrayText;
        border-radius:10px; padding:10px; box-shadow:0 10px 32px #0008 }
      #quote { max-height:100px; overflow:auto; margin:0 0 10px; padding:8px 10px;
        border-left:3px solid #268bd2; background:color-mix(in srgb, CanvasText 7%, Canvas);
        white-space:pre-wrap; font:12px/1.4 ui-monospace,monospace }
      textarea { display:block; width:100%; min-height:76px; max-height:30dvh; resize:vertical; padding:9px;
        color:CanvasText; background:Canvas; border:1px solid GrayText; border-radius:6px }
      #actions { display:flex; justify-content:flex-end; gap:8px; margin-top:10px }
      #actions button { pointer-events:auto; border:1px solid GrayText; border-radius:6px;
        padding:7px 11px; color:CanvasText; background:Canvas; cursor:pointer }
      #send { color:white!important; border-color:#268bd2!important; background:#268bd2!important }
      #status { min-height:18px; margin-right:auto; align-self:center; font-size:12px; color:GrayText }
      #toast { display:none; position:fixed; left:50%; bottom:22px; transform:translateX(-50%);
        color:white; background:#073642; padding:8px 12px; border-radius:7px; box-shadow:0 3px 16px #0007;
        font-size:12px }
    </style>
    <div id="card" role="dialog" aria-label="Add anchored comment">
      <div id="quote"></div>
      <textarea id="body" placeholder="What should the agent change?" maxlength="10000"></textarea>
      <div id="actions"><span id="status"></span><button id="cancel" type="button">Cancel</button><button id="send" type="button">Save</button></div>
    </div>
    <div id="toast">Comment saved</div>`;
  document.documentElement.append(host);

  const $ = (id) => shadow.getElementById(id);
  const card = $('card');
  const body = $('body');
  const quote = $('quote');
  const status = $('status');

  // Composer clicks must not look like a completed selection gesture. In
  // particular, Cancel should not immediately reopen for the old selection.
  host.addEventListener('pointerup', (event) => event.stopPropagation());

  function contextFor(range) {
    const before = document.createRange();
    before.selectNodeContents(document.body);
    before.setEnd(range.startContainer, range.startOffset);
    const after = document.createRange();
    after.selectNodeContents(document.body);
    after.setStart(range.endContainer, range.endOffset);
    return {
      type: 'text',
      quote: range.toString().slice(0, 12000),
      prefix: before.toString().slice(-300),
      suffix: after.toString().slice(0, 300),
    };
  }

  function positionCard() {
    if (!selectedRange || card.style.display === 'none') return;
    let rect;
    try { rect = selectedRange.getBoundingClientRect(); }
    catch { return; }
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft || 0;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportWidth = viewport?.width || innerWidth;
    const viewportHeight = viewport?.height || innerHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const margin = 8;
    const gap = 8;
    card.style.maxWidth = `${Math.max(0, viewportWidth - margin * 2)}px`;
    card.style.maxHeight = `${Math.max(0, viewportHeight - margin * 2)}px`;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    card.style.left = `${Math.max(viewportLeft + margin, Math.min(
      viewportRight - width - margin,
      rect.left + (rect.width - width) / 2,
    ))}px`;
    const below = rect.bottom + gap;
    const preferredTop = below + height <= viewportBottom - margin
      ? below : rect.top - height - gap;
    card.style.top = `${Math.max(viewportTop + margin, Math.min(
      viewportBottom - height - margin,
      preferredTop,
    ))}px`;
  }

  function captureSelection(focusComposer = false) {
    if (card.style.display === 'block') return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      return;
    }
    const range = selection.getRangeAt(0);
    const text = selection.toString();
    if (!text.trim() || text.length > 12000 || !document.body.contains(range.commonAncestorContainer)) {
      return;
    }
    selected = contextFor(range);
    selectedRange = range.cloneRange();
    draftVersion += 1;
    quote.textContent = selected.quote;
    status.textContent = '';
    body.value = '';
    $('send').disabled = false;
    card.style.display = 'block';
    positionCard();
    if (focusComposer) {
      body.focus();
      setTimeout(positionCard, 0);
    }
  }

  // Wait until selection gestures finish so the composer does not interrupt
  // an in-progress mouse/touch drag. Shift+keyboard selections open on keyup.
  document.addEventListener('pointerup', () => setTimeout(captureSelection, 0));
  document.addEventListener('keyup', (event) => {
    if (event.shiftKey) setTimeout(() => captureSelection(true), 0);
  });
  window.addEventListener('resize', positionCard);
  document.addEventListener('scroll', positionCard, true);
  window.visualViewport?.addEventListener('resize', positionCard);
  window.visualViewport?.addEventListener('scroll', positionCard);
  if (window.ResizeObserver) new ResizeObserver(positionCard).observe(card);

  function close() {
    card.style.display = 'none';
    status.textContent = '';
    selected = null;
    selectedRange = null;
    draftVersion += 1;
    window.getSelection()?.removeAllRanges();
  }

  $('cancel').addEventListener('click', close);
  $('send').addEventListener('click', async () => {
    const commentBody = body.value.trim();
    if (!commentBody || !selected) return body.focus();
    const submittedSelection = selected;
    const submittedVersion = draftVersion;
    $('send').disabled = true;
    status.textContent = 'Saving…';
    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentBody, target: { kind: 'page', pageToken, anchor: submittedSelection } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      if (submittedVersion === draftVersion && selected === submittedSelection) {
        close();
        window.getSelection()?.removeAllRanges();
      }
      const toast = $('toast');
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 1800);
    } catch (error) {
      if (submittedVersion === draftVersion) status.textContent = error.message;
    } finally {
      if (submittedVersion === draftVersion) $('send').disabled = false;
    }
  });
  body.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      $('send').click();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && card.style.display !== 'none') close();
  });
})();
