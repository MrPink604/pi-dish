import { decodeCommentEntries, decodePageComments, responseError } from './artifact-comment-data';
import type { PageComment, TextAnchor } from './artifact-comment-data';
import { clearCommentMarks, markCommentQuote, positionCommentCard } from './comment-anchors';

/* Anchored comments for pi-dish published pages.
 *
 * Injected only when a page is viewed through the main pi-dish server.  It
 * lives in a shadow root so generated artifacts cannot accidentally restyle
 * the controls (and these controls cannot restyle the artifact).
 */
(() => {
  const script = document.currentScript;
  const pageToken = script instanceof HTMLScriptElement ? script.dataset.pageToken : undefined;
  if (!pageToken || window.top !== window.self) return;

  let selected: TextAnchor | null = null;
  let selectedRange: Range | null = null;
  let draftVersion = 0;
  let editing: PageComment | null = null;   // the open comment the card is editing, if any
  let openComments: readonly PageComment[] = [];
  let refreshVersion = 0;
  let deleteArmed = false;
  let deleteTimer: ReturnType<typeof setTimeout> | null = null;
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
      #del { color:GrayText }
      #del.armed { color:#dc322f!important; border-color:#dc322f!important }
      #toast { display:none; position:fixed; left:50%; bottom:22px; transform:translateX(-50%);
        color:white; background:#073642; padding:8px 12px; border-radius:7px; box-shadow:0 3px 16px #0007;
        font-size:12px }
    </style>
    <div id="card" role="dialog" aria-label="Add anchored comment">
      <div id="quote"></div>
      <textarea id="body" placeholder="What should the agent change?" maxlength="10000"></textarea>
      <div id="actions"><button id="del" type="button" hidden>Delete</button><span id="status"></span><button id="cancel" type="button">Cancel</button><button id="send" type="button">Save</button></div>
    </div>
    <div id="toast">Comment saved</div>`;
  document.documentElement.append(host);

  function element<T extends HTMLElement>(id: string, type: { new(): T }): T {
    const value = shadow.getElementById(id);
    if (!(value instanceof type)) throw new Error(`Missing comment control: ${id}`);
    return value;
  }
  const $ = (id: string) => element(id, HTMLElement);
  const sendButton = element('send', HTMLButtonElement);
  const deleteButton = element('del', HTMLButtonElement);
  const card = $('card');
  const body = element('body', HTMLTextAreaElement);
  const quote = $('quote');
  const status = $('status');

  // Composer clicks must not look like a completed selection gesture. In
  // particular, Cancel should not immediately reopen for the old selection.
  host.addEventListener('pointerup', (event) => event.stopPropagation());

  function contextFor(range: Range): TextAnchor {
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
    positionCommentCard(card, rect);
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
    editing = null;
    deleteButton.hidden = true;
    disarmDelete();
    deleteButton.disabled = false;
    draftVersion += 1;
    quote.textContent = selected.quote;
    status.textContent = '';
    body.value = '';
    sendButton.disabled = false;
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
    editing = null;
    deleteButton.hidden = true;
    disarmDelete();
    deleteButton.disabled = false;
    draftVersion += 1;
    window.getSelection()?.removeAllRanges();
  }

  function disarmDelete() {
    if (deleteTimer !== null) clearTimeout(deleteTimer);
    deleteTimer = null;
    deleteArmed = false;
    deleteButton.textContent = 'Delete';
    deleteButton.classList.remove('armed');
  }

  $('cancel').addEventListener('click', close);
  sendButton.addEventListener('click', async () => {
    const commentBody = body.value.trim();
    const submittedEdit = editing;
    const submittedSelection = selected;
    if (!commentBody || (!submittedSelection && !submittedEdit)) return body.focus();
    const submittedVersion = draftVersion;
    sendButton.disabled = true;
    status.textContent = 'Saving…';
    try {
      const response = submittedEdit
        ? await fetch(`/api/comments/${encodeURIComponent(submittedEdit.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          // pageToken travels on every call so a hub fronting this page can
          // route it to the host that owns the comment (older servers ignore it).
          body: JSON.stringify({ sessionId: submittedEdit.sessionId, body: commentBody, pageToken }),
        })
        : await fetch('/api/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: commentBody, target: { kind: 'page', pageToken, anchor: submittedSelection } }),
        });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(responseError(result, response.status));
      if (submittedVersion === draftVersion
          && (submittedEdit ? editing === submittedEdit : selected === submittedSelection)) {
        close();
        window.getSelection()?.removeAllRanges();
      }
      toast(submittedEdit ? 'Comment updated' : 'Comment saved');
      refreshComments();
    } catch (error) {
      if (submittedVersion === draftVersion) status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      if (submittedVersion === draftVersion) sendButton.disabled = false;
    }
  });

  // Two-tap confirm, matching the app's delete idiom.
  deleteButton.addEventListener('click', async () => {
    const target = editing;
    if (!target) return;
    if (!deleteArmed) {
      deleteArmed = true;
      deleteButton.textContent = 'Delete?';
      deleteButton.classList.add('armed');
      deleteTimer = setTimeout(disarmDelete, 3000);
      return;
    }
    const submittedVersion = draftVersion;
    deleteButton.disabled = true;
    status.textContent = 'Deleting…';
    try {
      const response = await fetch(`/api/comments/${encodeURIComponent(target.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: target.sessionId, pageToken }),
      });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(responseError(result, response.status));
      if (submittedVersion === draftVersion) close();
      toast('Comment deleted');
      refreshComments();
    } catch (error) {
      if (submittedVersion === draftVersion) { status.textContent = error instanceof Error ? error.message : String(error); disarmDelete(); }
    } finally {
      if (submittedVersion === draftVersion) deleteButton.disabled = false;
    }
  });

  function toast(text: string) {
    const el = $('toast');
    el.textContent = text;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 1800);
  }
  body.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      sendButton.click();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && card.style.display !== 'none') close();
  });

  // --- Open comments, anchored back into the artifact ------------------
  // Saved feedback stays visible on the page it was written on until the
  // agent acknowledges it, and stays editable/deletable that whole time.
  // The marks live in the artifact document, out of reach of the shadow
  // stylesheet, so they get one attribute-scoped rule of their own.
  const markStyle = document.createElement('style');
  markStyle.setAttribute('data-pi-dish', '');
  markStyle.textContent = 'mark[data-pi-dish-comment] { background: rgba(38,139,210,.16);'
    + ' border-bottom: 1px dotted rgba(38,139,210,.75); color: inherit; cursor: pointer; }';
  (document.head || document.documentElement).append(markStyle);

  const markPolicy = { exclude: 'script, style, #pi-dish-comment-layer', idAttribute: 'data-pi-dish-comment' };

  function renderMarks() {
    clearCommentMarks(document.documentElement, 'mark[data-pi-dish-comment]');
    for (const comment of openComments) markCommentQuote(document.body, comment.target.anchor, comment.id, markPolicy);
  }

  // The page knows its own token, not the session behind it; the index
  // hands back both. Any failure just leaves the artifact unmarked.
  async function refreshComments() {
    const version = ++refreshVersion;
    try {
      const indexRes = await fetch(`/api/comments/index?pageToken=${encodeURIComponent(pageToken || '')}`);
      if (!indexRes.ok) return;
      const index: unknown = await indexRes.json();
      if (version !== refreshVersion) return;
      const entries = decodeCommentEntries(index);
      if (!entries.length) { openComments = []; renderMarks(); return; }
      const fullRes = await fetch('/api/comments/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: entries[0].sessionId, ids: entries.map((e) => e.id), pageToken }),
      });
      if (!fullRes.ok) return;
      const full: unknown = await fullRes.json();
      if (version !== refreshVersion) return;
      openComments = decodePageComments(full);
      renderMarks();
    } catch { /* an unmarked page still renders */ }
  }

  document.addEventListener('click', (event) => {
    const mark = event.target instanceof Element ? event.target.closest('mark[data-pi-dish-comment]') : null;
    if (!mark || window.getSelection()?.isCollapsed === false) return;
    const comment = openComments.find((entry) => entry.id === mark.getAttribute('data-pi-dish-comment'));
    if (!comment) return;
    editing = comment;
    selected = null;
    selectedRange = document.createRange();
    selectedRange.selectNodeContents(mark);
    draftVersion += 1;
    disarmDelete();
    deleteButton.disabled = false;
    quote.textContent = comment.target?.anchor?.quote || '';
    body.value = comment.body;
    status.textContent = '';
    sendButton.disabled = false;
    deleteButton.hidden = false;
    card.style.display = 'block';
    positionCard();
    body.focus();
    setTimeout(positionCard, 0);
  });

  refreshComments();
})();
