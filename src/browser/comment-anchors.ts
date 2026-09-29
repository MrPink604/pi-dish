import type { CommentAnchor } from './anchored-comment-data';

interface QuoteAnchor {
  readonly quote: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

interface CommentMarkPolicy {
  readonly exclude: string;
  readonly className?: string;
  readonly idAttribute: string;
}

const appMarkPolicy: CommentMarkPolicy = {
  exclude: 'script, style',
  className: 'comment-mark',
  idAttribute: 'data-comment-id',
};

export function selectionTextAnchor(root: HTMLElement, range: Range): CommentAnchor {
  const document = root.ownerDocument;
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(root);
  after.setStart(range.endContainer, range.endOffset);
  return {
    type: 'text',
    // Keep the exact selected extent. Trimming would leave prefix/suffix
    // relative to different boundaries and break exact re-anchoring.
    quote: range.toString(),
    prefix: before.toString().slice(-300),
    suffix: after.toString().slice(0, 300),
  };
}

export function clearCommentMarks(root: HTMLElement, selector = 'mark.comment-mark') {
  const document = root.ownerDocument;
  root.querySelectorAll(selector).forEach((mark) => {
    const parent = mark.parentNode;
    mark.replaceWith(document.createTextNode(mark.textContent || ''));
    parent?.normalize();
  });
}

// A rendered quote routinely spans several text nodes (markdown turns one
// sentence into text + <code> + text), so markSearchTokens' per-node scan
// can't find it. Flatten the subtree into one string with per-node offsets,
// locate the quote there, then wrap the covered slice of each node.
function collectTextRuns(root: HTMLElement, exclude: string) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(exclude)
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const runs: { node: Text; start: number; end: number }[] = [];
  let text = '';
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    runs.push({ node, start: text.length, end: text.length + node.textContent.length });
    text += node.textContent;
  }
  return { runs, text };
}

function commonSuffixLength(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

// Repeated quotes are the normal case for short selections, so pick the
// occurrence whose neighbours best match the anchor's recorded context.
export function findQuoteOffset<T extends QuoteAnchor>(text: string, anchor: T) {
  const quote = anchor?.quote;
  if (!quote) return -1;
  const hits = [];
  let from = 0;
  let at;
  while ((at = text.indexOf(quote, from)) !== -1) {
    hits.push(at);
    from = at + Math.max(1, quote.length);
  }
  if (hits.length < 2) return hits.length ? hits[0] : -1;
  const prefix = anchor.prefix || '';
  const suffix = anchor.suffix || '';
  let best = hits[0];
  let bestScore = -1;
  for (const hit of hits) {
    const before = text.slice(Math.max(0, hit - prefix.length), hit);
    const after = text.slice(hit + quote.length, hit + quote.length + suffix.length);
    const score = commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix);
    if (score > bestScore) { bestScore = score; best = hit; }
  }
  return best;
}

export function markCommentQuote<T extends QuoteAnchor>(
  root: HTMLElement, anchor: T, commentId: string, policy: CommentMarkPolicy = appMarkPolicy,
) {
  const document = root.ownerDocument;
  const quote = anchor?.quote;
  if (!quote) return false;
  const { runs, text } = collectTextRuns(root, policy.exclude);
  const start = findQuoteOffset(text, anchor);
  if (start < 0) return false; // unanchorable — the chip list still reaches it
  const end = start + quote.length;
  let marked = false;
  for (const run of runs) {
    if (run.end <= start || run.start >= end) continue;
    const from = Math.max(0, start - run.start);
    const to = Math.min(run.node.textContent.length, end - run.start);
    if (to <= from) continue;
    const source = run.node.textContent;
    const mark = document.createElement('mark');
    if (policy.className) mark.className = policy.className;
    mark.setAttribute(policy.idAttribute, commentId);
    mark.textContent = source.slice(from, to);
    const frag = document.createDocumentFragment();
    if (from > 0) frag.appendChild(document.createTextNode(source.slice(0, from)));
    frag.appendChild(mark);
    if (to < source.length) frag.appendChild(document.createTextNode(source.slice(to)));
    // Replacing only this node keeps every other run reference (and the
    // flattened offsets they were computed from) valid.
    run.node.replaceWith(frag);
    marked = true;
  }
  return marked;
}

function commentCardPosition(
  rect: Pick<DOMRectReadOnly, 'left' | 'top' | 'bottom' | 'width'>,
  width: number, height: number,
  viewportLeft: number, viewportTop: number, viewportWidth: number, viewportHeight: number,
) {
  const margin = 8, gap = 8;
  const left = Math.max(viewportLeft + margin, Math.min(
    viewportLeft + viewportWidth - width - margin, rect.left + (rect.width - width) / 2,
  ));
  const below = rect.bottom + gap;
  const preferred = below + height <= viewportTop + viewportHeight - margin
    ? below : rect.top - height - gap;
  const top = Math.max(viewportTop + margin, Math.min(
    viewportTop + viewportHeight - height - margin, preferred,
  ));
  return { left, top };
}

export function positionCommentCard(card: HTMLElement, rect: DOMRectReadOnly) {
  const window = card.ownerDocument.defaultView!;
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
  const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
  // Constrain first: these styles can change both measured dimensions.
  card.style.maxWidth = `${Math.max(0, width - 16)}px`;
  card.style.maxHeight = `${Math.max(0, height - 16)}px`;
  const position = commentCardPosition(rect, card.offsetWidth, card.offsetHeight, left, top, width, height);
  card.style.left = `${position.left}px`;
  card.style.top = `${position.top}px`;
}

