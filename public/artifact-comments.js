// Generated from src/browser/; edit sources and run npm run build:browser.
(() => {
  // src/browser/artifact-comment-data.ts
  function record(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function comments(value) {
    return record(value) && Array.isArray(value.comments) ? value.comments : [];
  }
  function decodeCommentEntries(value) {
    return comments(value).flatMap((entry) => record(entry) && typeof entry.id === "string" && entry.id && typeof entry.sessionId === "string" && entry.sessionId ? [{ id: entry.id, sessionId: entry.sessionId }] : []);
  }
  function decodePageComments(value) {
    return comments(value).flatMap((entry) => {
      if (!record(entry) || typeof entry.id !== "string" || !entry.id || typeof entry.sessionId !== "string" || !entry.sessionId || typeof entry.body !== "string" || !record(entry.target) || !record(entry.target.anchor)) return [];
      const anchor = entry.target.anchor;
      if (typeof anchor.quote !== "string" || !anchor.quote) return [];
      return [{
        id: entry.id,
        sessionId: entry.sessionId,
        body: entry.body,
        target: { anchor: {
          type: "text",
          quote: anchor.quote,
          prefix: typeof anchor.prefix === "string" ? anchor.prefix : "",
          suffix: typeof anchor.suffix === "string" ? anchor.suffix : ""
        } }
      }];
    });
  }
  function responseError(value, status) {
    return record(value) && typeof value.error === "string" && value.error ? value.error : `HTTP ${status}`;
  }

  // src/browser/artifact-comments.ts
  (() => {
    const script = document.currentScript;
    const pageToken = script instanceof HTMLScriptElement ? script.dataset.pageToken : void 0;
    if (!pageToken || window.top !== window.self) return;
    let selected = null;
    let selectedRange = null;
    let draftVersion = 0;
    let editing = null;
    let openComments = [];
    let refreshVersion = 0;
    let deleteArmed = false;
    let deleteTimer = null;
    const host = document.createElement("div");
    host.id = "pi-dish-comment-layer";
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    const shadow = host.attachShadow({ mode: "closed" });
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
    function element(id, type) {
      const value = shadow.getElementById(id);
      if (!(value instanceof type)) throw new Error(`Missing comment control: ${id}`);
      return value;
    }
    const $ = (id) => element(id, HTMLElement);
    const sendButton = element("send", HTMLButtonElement);
    const deleteButton = element("del", HTMLButtonElement);
    const card = $("card");
    const body = element("body", HTMLTextAreaElement);
    const quote = $("quote");
    const status = $("status");
    host.addEventListener("pointerup", (event) => event.stopPropagation());
    function contextFor(range) {
      const before = document.createRange();
      before.selectNodeContents(document.body);
      before.setEnd(range.startContainer, range.startOffset);
      const after = document.createRange();
      after.selectNodeContents(document.body);
      after.setStart(range.endContainer, range.endOffset);
      return {
        type: "text",
        quote: range.toString().slice(0, 12e3),
        prefix: before.toString().slice(-300),
        suffix: after.toString().slice(0, 300)
      };
    }
    function positionCard() {
      if (!selectedRange || card.style.display === "none") return;
      let rect;
      try {
        rect = selectedRange.getBoundingClientRect();
      } catch {
        return;
      }
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
        rect.left + (rect.width - width) / 2
      ))}px`;
      const below = rect.bottom + gap;
      const preferredTop = below + height <= viewportBottom - margin ? below : rect.top - height - gap;
      card.style.top = `${Math.max(viewportTop + margin, Math.min(
        viewportBottom - height - margin,
        preferredTop
      ))}px`;
    }
    function captureSelection(focusComposer = false) {
      if (card.style.display === "block") return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        return;
      }
      const range = selection.getRangeAt(0);
      const text = selection.toString();
      if (!text.trim() || text.length > 12e3 || !document.body.contains(range.commonAncestorContainer)) {
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
      status.textContent = "";
      body.value = "";
      sendButton.disabled = false;
      card.style.display = "block";
      positionCard();
      if (focusComposer) {
        body.focus();
        setTimeout(positionCard, 0);
      }
    }
    document.addEventListener("pointerup", () => setTimeout(captureSelection, 0));
    document.addEventListener("keyup", (event) => {
      if (event.shiftKey) setTimeout(() => captureSelection(true), 0);
    });
    window.addEventListener("resize", positionCard);
    document.addEventListener("scroll", positionCard, true);
    window.visualViewport?.addEventListener("resize", positionCard);
    window.visualViewport?.addEventListener("scroll", positionCard);
    if (window.ResizeObserver) new ResizeObserver(positionCard).observe(card);
    function close() {
      card.style.display = "none";
      status.textContent = "";
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
      deleteButton.textContent = "Delete";
      deleteButton.classList.remove("armed");
    }
    $("cancel").addEventListener("click", close);
    sendButton.addEventListener("click", async () => {
      const commentBody = body.value.trim();
      const submittedEdit = editing;
      const submittedSelection = selected;
      if (!commentBody || !submittedSelection && !submittedEdit) return body.focus();
      const submittedVersion = draftVersion;
      sendButton.disabled = true;
      status.textContent = "Saving\u2026";
      try {
        const response = submittedEdit ? await fetch(`/api/comments/${encodeURIComponent(submittedEdit.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // pageToken travels on every call so a hub fronting this page can
          // route it to the host that owns the comment (older servers ignore it).
          body: JSON.stringify({ sessionId: submittedEdit.sessionId, body: commentBody, pageToken })
        }) : await fetch("/api/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: commentBody, target: { kind: "page", pageToken, anchor: submittedSelection } })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(responseError(result, response.status));
        if (submittedVersion === draftVersion && (submittedEdit ? editing === submittedEdit : selected === submittedSelection)) {
          close();
          window.getSelection()?.removeAllRanges();
        }
        toast(submittedEdit ? "Comment updated" : "Comment saved");
        refreshComments();
      } catch (error) {
        if (submittedVersion === draftVersion) status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        if (submittedVersion === draftVersion) sendButton.disabled = false;
      }
    });
    deleteButton.addEventListener("click", async () => {
      const target = editing;
      if (!target) return;
      if (!deleteArmed) {
        deleteArmed = true;
        deleteButton.textContent = "Delete?";
        deleteButton.classList.add("armed");
        deleteTimer = setTimeout(disarmDelete, 3e3);
        return;
      }
      const submittedVersion = draftVersion;
      deleteButton.disabled = true;
      status.textContent = "Deleting\u2026";
      try {
        const response = await fetch(`/api/comments/${encodeURIComponent(target.id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: target.sessionId, pageToken })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(responseError(result, response.status));
        if (submittedVersion === draftVersion) close();
        toast("Comment deleted");
        refreshComments();
      } catch (error) {
        if (submittedVersion === draftVersion) {
          status.textContent = error instanceof Error ? error.message : String(error);
          disarmDelete();
        }
      } finally {
        if (submittedVersion === draftVersion) deleteButton.disabled = false;
      }
    });
    function toast(text) {
      const el = $("toast");
      el.textContent = text;
      el.style.display = "block";
      setTimeout(() => {
        el.style.display = "none";
      }, 1800);
    }
    body.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        sendButton.click();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && card.style.display !== "none") close();
    });
    const markStyle = document.createElement("style");
    markStyle.setAttribute("data-pi-dish", "");
    markStyle.textContent = "mark[data-pi-dish-comment] { background: rgba(38,139,210,.16); border-bottom: 1px dotted rgba(38,139,210,.75); color: inherit; cursor: pointer; }";
    (document.head || document.documentElement).append(markStyle);
    function textRuns() {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => node.parentElement?.closest("script, style, #pi-dish-comment-layer") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      });
      const runs = [];
      let text = "";
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!(node instanceof Text)) continue;
        runs.push({ node, start: text.length, end: text.length + node.data.length });
        text += node.data;
      }
      return { runs, text };
    }
    function overlap(a, b, fromEnd) {
      let n = 0;
      while (n < a.length && n < b.length && (fromEnd ? a[a.length - 1 - n] === b[b.length - 1 - n] : a[n] === b[n])) n++;
      return n;
    }
    function markComment(comment) {
      const anchor = comment.target.anchor;
      const quote2 = anchor.quote;
      if (!quote2) return;
      const { runs, text } = textRuns();
      const hits = [];
      let from = 0;
      let at;
      while ((at = text.indexOf(quote2, from)) !== -1) {
        hits.push(at);
        from = at + Math.max(1, quote2.length);
      }
      if (!hits.length) return;
      let start = hits[0];
      if (hits.length > 1) {
        const prefix = anchor.prefix || "";
        const suffix = anchor.suffix || "";
        let bestScore = -1;
        for (const hit of hits) {
          const score = overlap(text.slice(Math.max(0, hit - prefix.length), hit), prefix, true) + overlap(text.slice(hit + quote2.length, hit + quote2.length + suffix.length), suffix, false);
          if (score > bestScore) {
            bestScore = score;
            start = hit;
          }
        }
      }
      const end = start + quote2.length;
      for (const run of runs) {
        if (run.end <= start || run.start >= end) continue;
        const source = run.node.data;
        const sliceFrom = Math.max(0, start - run.start);
        const sliceTo = Math.min(source.length, end - run.start);
        if (sliceTo <= sliceFrom) continue;
        const mark = document.createElement("mark");
        mark.setAttribute("data-pi-dish-comment", comment.id);
        mark.textContent = source.slice(sliceFrom, sliceTo);
        const frag = document.createDocumentFragment();
        if (sliceFrom > 0) frag.appendChild(document.createTextNode(source.slice(0, sliceFrom)));
        frag.appendChild(mark);
        if (sliceTo < source.length) frag.appendChild(document.createTextNode(source.slice(sliceTo)));
        run.node.replaceWith(frag);
      }
    }
    function renderMarks() {
      document.querySelectorAll("mark[data-pi-dish-comment]").forEach((mark) => {
        const parent = mark.parentNode;
        mark.replaceWith(document.createTextNode(mark.textContent || ""));
        parent?.normalize();
      });
      for (const comment of openComments) markComment(comment);
    }
    async function refreshComments() {
      const version = ++refreshVersion;
      try {
        const indexRes = await fetch(`/api/comments/index?pageToken=${encodeURIComponent(pageToken || "")}`);
        if (!indexRes.ok) return;
        const index = await indexRes.json();
        if (version !== refreshVersion) return;
        const entries = decodeCommentEntries(index);
        if (!entries.length) {
          openComments = [];
          renderMarks();
          return;
        }
        const fullRes = await fetch("/api/comments/get", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: entries[0].sessionId, ids: entries.map((e) => e.id), pageToken })
        });
        if (!fullRes.ok) return;
        const full = await fullRes.json();
        if (version !== refreshVersion) return;
        openComments = decodePageComments(full);
        renderMarks();
      } catch {
      }
    }
    document.addEventListener("click", (event) => {
      const mark = event.target instanceof Element ? event.target.closest("mark[data-pi-dish-comment]") : null;
      if (!mark || window.getSelection()?.isCollapsed === false) return;
      const comment = openComments.find((entry) => entry.id === mark.getAttribute("data-pi-dish-comment"));
      if (!comment) return;
      editing = comment;
      selected = null;
      selectedRange = document.createRange();
      selectedRange.selectNodeContents(mark);
      draftVersion += 1;
      disarmDelete();
      deleteButton.disabled = false;
      quote.textContent = comment.target?.anchor?.quote || "";
      body.value = comment.body;
      status.textContent = "";
      sendButton.disabled = false;
      deleteButton.hidden = false;
      card.style.display = "block";
      positionCard();
      body.focus();
      setTimeout(positionCard, 0);
    });
    refreshComments();
  })();
})();
