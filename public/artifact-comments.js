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
  const host = document.createElement('div');
  host.id = 'pi-dish-comment-layer';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      * { box-sizing:border-box; font-family:ui-sans-serif,system-ui,sans-serif }
      button,textarea { font:inherit }
      #add { display:none; position:fixed; pointer-events:auto; border:0; border-radius:999px;
        padding:7px 11px; color:white; background:#268bd2; box-shadow:0 3px 16px #0007;
        font-size:12px; font-weight:650; cursor:pointer }
      #veil { display:none; position:fixed; inset:0; pointer-events:auto; background:#0008;
        align-items:center; justify-content:center; padding:20px }
      #card { width:min(460px,100%); color:CanvasText; background:Canvas; border:1px solid GrayText;
        border-radius:10px; padding:14px; box-shadow:0 12px 40px #0008 }
      #quote { max-height:100px; overflow:auto; margin:0 0 10px; padding:8px 10px;
        border-left:3px solid #268bd2; background:color-mix(in srgb, CanvasText 7%, Canvas);
        white-space:pre-wrap; font:12px/1.4 ui-monospace,monospace }
      textarea { display:block; width:100%; min-height:100px; resize:vertical; padding:9px;
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
    <button id="add" type="button">Comment</button>
    <div id="veil">
      <div id="card" role="dialog" aria-modal="true" aria-label="Add anchored comment">
        <div id="quote"></div>
        <textarea id="body" placeholder="What should the agent change?" maxlength="10000"></textarea>
        <div id="actions"><span id="status"></span><button id="cancel" type="button">Cancel</button><button id="send" type="button">Save</button></div>
      </div>
    </div>
    <div id="toast">Comment saved</div>`;
  document.documentElement.append(host);

  const $ = (id) => shadow.getElementById(id);
  const add = $('add');
  const veil = $('veil');
  const body = $('body');
  const quote = $('quote');
  const status = $('status');

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

  function captureSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      add.style.display = 'none';
      return;
    }
    const range = selection.getRangeAt(0);
    const text = selection.toString();
    if (!text.trim() || text.length > 12000 || !document.body.contains(range.commonAncestorContainer)) {
      add.style.display = 'none';
      return;
    }
    selected = contextFor(range);
    const rect = range.getBoundingClientRect();
    add.style.left = `${Math.max(8, Math.min(innerWidth - 90, rect.right - 76))}px`;
    add.style.top = `${Math.max(8, Math.min(innerHeight - 44, rect.bottom + 6))}px`;
    add.style.display = 'block';
  }

  document.addEventListener('selectionchange', () => setTimeout(captureSelection, 0));
  add.addEventListener('pointerdown', (event) => event.preventDefault());
  add.addEventListener('click', () => {
    if (!selected) return;
    quote.textContent = selected.quote;
    status.textContent = '';
    body.value = '';
    veil.style.display = 'flex';
    add.style.display = 'none';
    body.focus();
  });

  function close() {
    veil.style.display = 'none';
    status.textContent = '';
  }

  $('cancel').addEventListener('click', close);
  veil.addEventListener('click', (event) => { if (event.target === veil) close(); });
  $('send').addEventListener('click', async () => {
    const commentBody = body.value.trim();
    if (!commentBody || !selected) return body.focus();
    $('send').disabled = true;
    status.textContent = 'Saving…';
    try {
      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentBody, target: { kind: 'page', pageToken, anchor: selected } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      close();
      window.getSelection()?.removeAllRanges();
      const toast = $('toast');
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 1800);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      $('send').disabled = false;
    }
  });
  body.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      $('send').click();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && veil.style.display !== 'none') close();
  });
})();
