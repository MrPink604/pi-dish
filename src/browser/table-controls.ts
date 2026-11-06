/**
 * Sort and filter controls for rendered markdown tables.
 *
 * Enhancement runs inside the rich-text post-render pass (final renders only)
 * and is idempotent. All state lives in the DOM — `aria-sort` on the header,
 * `data-table-order` on each row, the filter input's value, `hidden` rows —
 * so a retained transcript fragment restores exactly as the reader left it,
 * and every event is delegated on the document, so moved nodes need no
 * rebinding.
 */

/** Tables with at least this many body rows also get a filter box. */
const FILTER_MIN_ROWS = 5;

type SortDirection = 'ascending' | 'descending';

/** A cell's sort key: its normalized text plus, when it reads as one, a number and its unit. */
interface TableSortKey { text: string; number: number | null; unit: string }

// One number with optional sign, currency prefix, thousands separators and a
// short trailing unit (`%`, `ms`, `x`, `GB`). Version strings and dates do not
// match (their "unit" would contain digits) and fall back to text order.
const NUMBER_RE = /^([-+\u2212]?)[$€£¥]?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)\s*([^\d\s]{0,4})$/u;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function tableSortKey(raw: string): TableSortKey {
  const text = raw.replace(/\s+/g, ' ').trim();
  const match = NUMBER_RE.exec(text);
  if (!match) return { text, number: null, unit: '' };
  const value = Number(match[2].replace(/,/g, ''));
  return { text, number: match[1] && match[1] !== '+' ? -value : value, unit: match[3].toLowerCase() };
}

/**
 * Ascending comparison. Numbers sharing a unit compare by value; anything else
 * uses natural text order (`item2` before `item10`). Empty cells are not
 * handled here: the caller keeps them last in both directions.
 */
function compareTableSortKeys(a: TableSortKey, b: TableSortKey) {
  if (a.number !== null && b.number !== null && a.unit === b.unit) return a.number - b.number;
  return collator.compare(a.text, b.text);
}

export function createTableControls(options: { document: Document }) {
  const { document } = options;
  const events = new AbortController();
  const { signal } = events;

  function enhance(root: ParentNode) {
    root.querySelectorAll<HTMLTableElement>('.markdown-body table:not([data-table-controls])').forEach(table => {
      const rows = Array.from(table.tBodies[0]?.rows || []), head = table.tHead?.rows[0];
      // Marked always emits a header row; a table with one data row has nothing to reorder.
      if (!head || rows.length < 2) return;
      table.dataset.tableControls = '1';
      rows.forEach((row, index) => { row.dataset.tableOrder = String(index); });
      for (const cell of Array.from(head.cells)) {
        cell.classList.add('md-table-sortable');
        cell.tabIndex = 0;
        cell.title = 'Sort by this column';
      }
      if (rows.length < FILTER_MIN_ROWS || !table.parentNode) return;
      const wrap = document.createElement('div'); wrap.className = 'md-table';
      const tools = document.createElement('div'); tools.className = 'md-table-tools';
      const input = document.createElement('input');
      input.type = 'search'; input.className = 'md-table-filter';
      input.placeholder = 'Filter rows'; input.setAttribute('aria-label', 'Filter table rows');
      input.autocomplete = 'off'; input.spellcheck = false;
      tools.append(input);
      table.replaceWith(wrap);
      wrap.append(tools, table);
    });
  }

  function sort(cell: HTMLTableCellElement) {
    const table = cell.closest('table'), tbody = table?.tBodies[0];
    if (!table || !tbody) return;
    // none → ascending → descending → original order.
    const current = cell.getAttribute('aria-sort');
    const next: SortDirection | null = current === 'ascending' ? 'descending' : current === 'descending' ? null : 'ascending';
    for (const header of Array.from(table.tHead?.rows[0]?.cells || [])) header.removeAttribute('aria-sort');
    if (next) cell.setAttribute('aria-sort', next);
    const column = cell.cellIndex, sign = next === 'descending' ? -1 : 1;
    const rows = Array.from(tbody.rows).map(row => ({ row, order: Number(row.dataset.tableOrder), key: tableSortKey(row.cells[column]?.textContent || '') }));
    rows.sort((a, b) => {
      if (next) {
        const aEmpty = !a.key.text, bEmpty = !b.key.text;
        if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
        const result = aEmpty ? 0 : compareTableSortKeys(a.key, b.key);
        if (result) return sign * result;
      }
      return a.order - b.order;
    });
    tbody.append(...rows.map(entry => entry.row));
  }

  function filter(input: HTMLInputElement) {
    const wrap = input.closest('.md-table'), table = wrap?.querySelector('table');
    if (!wrap || !table) return;
    // Every whitespace-separated term must appear somewhere in the row.
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean), rows = Array.from(table.tBodies[0]?.rows || []);
    let visible = 0;
    for (const row of rows) {
      const text = (row.textContent || '').toLowerCase();
      row.hidden = !terms.every(term => text.includes(term));
      if (!row.hidden) visible++;
    }
    // A CSS-rendered count keeps the status out of the transcript's text.
    const tools = wrap.querySelector<HTMLElement>('.md-table-tools');
    if (tools) {
      if (terms.length) tools.dataset.count = `${visible} of ${rows.length}`;
      else delete tools.dataset.count;
    }
  }

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const cell = target?.closest<HTMLTableCellElement>('.markdown-body th.md-table-sortable');
    // Links inside a header keep their own behavior.
    if (cell && !target?.closest('a, button')) sort(cell);
  }, { signal });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const cell = event.target;
    if (!(cell instanceof HTMLTableCellElement) || !cell.matches('.markdown-body th.md-table-sortable')) return;
    event.preventDefault(); sort(cell);
  }, { signal });
  document.addEventListener('input', event => {
    if (event.target instanceof HTMLInputElement && event.target.classList.contains('md-table-filter')) filter(event.target);
  }, { signal });

  return { enhance, dispose() { events.abort(); } };
}
