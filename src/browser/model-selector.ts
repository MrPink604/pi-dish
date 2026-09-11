import type { CatalogModel } from '../core/session-api';
import type { SelectionOwner } from '../../public/session-state';

export interface ModelSelectorView {
  owner: SelectionOwner;
  models: readonly Readonly<CatalogModel>[];
  currentModel: string | null;
  harnessId: string | null;
  query: string;
  editMode: boolean;
}
export interface ModelSelectorActions {
  requestClose(owner: SelectionOwner): void;
  queryChanged(owner: SelectionOwner, query: string): void;
  editModeChanged(owner: SelectionOwner, editing: boolean): void;
  selectModel(owner: SelectionOwner, selector: string): void;
  toggleModel(owner: SelectionOwner, selector: string): void;
  toggleProvider(owner: SelectionOwner, provider: string): void;
  setAllEnabled(owner: SelectionOwner, enabled: boolean): void;
}

/** Owns only root's children. The shell owns visibility, placement and requests. */
export function mountModelSelector(root: HTMLElement, actions: ModelSelectorActions,
  formatTokens: (tokens: number) => string) {
  const doc = root.ownerDocument;
  let view: ModelSelectorView | null = null;
  let disposed = false;
  function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const search = element('input', 'model-search');
  search.type = 'text'; search.placeholder = 'Search models...';
  const results = element('div', 'model-results');
  const footer = element('div', 'model-dropdown-footer');
  root.replaceChildren(search, results, footer);

  function active(model: Readonly<CatalogModel>, current: string | null) {
    return model.id === current || `${model.provider}/${model.id}` === current;
  }
  function action(node: HTMLElement, name: string, value = '') {
    node.dataset.action = name;
    node.dataset.value = value;
    return node;
  }
  function button(text: string, name: string, value = '', primary = false) {
    const node = element('button', 'model-footer-btn' + (primary ? ' primary' : ''), text);
    node.type = 'button';
    return action(node, name, value);
  }
  function update(next: ModelSelectorView) {
    if (disposed) return;
    // Copy the presentation fields so external catalog edits need an explicit update.
    view = { ...next, models: next.models.map(model => ({ ...model })) };
    const { models, currentModel, query, editMode, harnessId } = view;
    if (search.value !== query) search.value = query;
    const q = query.toLowerCase();
    const filtered = models.filter(model => !q || [model.id, model.provider, model.name]
      .some(value => value.toLowerCase().includes(q)));
    const visible = editMode ? filtered : filtered.filter(model => model.enabled !== false || active(model, currentModel));
    const hidden = filtered.length - visible.length;
    const groups = new Map<string, Readonly<CatalogModel>[]>();
    for (const model of visible) {
      const group = groups.get(model.provider) || [];
      group.push(model); groups.set(model.provider, group);
    }
    const fragment = doc.createDocumentFragment();
    for (const provider of [...groups.keys()].sort()) {
      const group = groups.get(provider)!;
      const header = element('div', 'model-group-header' + (editMode ? ' model-group-toggle' : ''));
      if (editMode) {
        const on = group.filter(model => model.enabled !== false).length;
        action(header, 'provider', provider);
        header.title = `Toggle all ${provider} models`;
        header.append(element('span', 'model-check', on === group.length ? '✓' : on ? '–' : ''),
          doc.createTextNode(provider), element('span', 'model-group-count', `${on}/${group.length}`));
      } else header.textContent = provider;
      fragment.append(header);
      for (const model of group) {
        const on = model.enabled !== false;
        const fullId = `${model.provider}/${model.id}`;
        const row = element('div', 'model-option' + (active(model, currentModel) ? ' active' : '') + (editMode && !on ? ' disabled' : ''));
        row.title = fullId;
        action(row, editMode ? 'toggle' : 'select', fullId);
        if (editMode) row.append(element('span', 'model-check', on ? '✓' : ''));
        const copy = element('span', 'model-option-copy');
        copy.append(element('span', 'model-option-name', model.id),
          element('span', 'model-option-context', model.contextWindow ? `${formatTokens(model.contextWindow)} context` : 'context unknown'));
        row.append(copy);
        if (model.free) row.append(element('span', 'model-badge free', 'free'));
        if (model.reasoning) row.append(element('span', 'model-badge reasoning', '🧠'));
        fragment.append(row);
      }
    }
    if (!visible.length) {
      const empty = element('div', 'model-option', 'No models found');
      empty.style.color = 'var(--text-muted)'; empty.style.cursor = 'default';
      fragment.append(empty);
    }
    const scrollTop = results.scrollTop;
    results.replaceChildren(fragment);
    results.scrollTop = scrollTop;
    footer.replaceChildren();
    if (editMode) {
      footer.append(element('span', 'model-footer-info', `${models.filter(model => model.enabled !== false).length} of ${models.length} enabled`),
        button('All', 'all', 'true'), button('None', 'all', 'false'), button('Done', 'edit', 'false', true));
    } else {
      if (hidden) footer.append(element('span', 'model-footer-info', `${hidden} hidden`));
      if (harnessId === 'pi') {
        const edit = button('⚙ Edit models', 'edit', 'true');
        edit.title = 'Choose which models are enabled (pi scoped models)';
        footer.append(edit);
      }
    }
  }
  function onInput(event: Event) {
    if (view && event.target === search) actions.queryChanged(view.owner, search.value);
  }
  function onKeydown(event: KeyboardEvent) {
    if (view && event.key === 'Escape') actions.requestClose(view.owner);
  }
  function onClick(event: MouseEvent) {
    const target = event.target;
    if (!view || !(target instanceof Element)) return;
    const node = target.closest<HTMLElement>('[data-action]');
    if (!node || !root.contains(node)) return;
    const { owner } = view;
    const value = node.dataset.value || '';
    switch (node.dataset.action) {
      case 'select': actions.selectModel(owner, value); break;
      case 'toggle': actions.toggleModel(owner, value); break;
      case 'provider': actions.toggleProvider(owner, value); break;
      case 'all': actions.setAllEnabled(owner, value === 'true'); break;
      case 'edit': actions.editModeChanged(owner, value === 'true'); break;
    }
  }
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKeydown);
  root.addEventListener('click', onClick);
  return {
    update,
    focusSearch() { if (!disposed) search.focus(); },
    dispose() {
      if (disposed) return;
      disposed = true; view = null;
      root.removeEventListener('input', onInput);
      root.removeEventListener('keydown', onKeydown);
      root.removeEventListener('click', onClick);
      root.replaceChildren();
    },
  };
}
