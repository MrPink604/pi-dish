import type { ApiRequest } from './api-client';
import { decodeDirectoryChildren, sameDirectoryHost } from './directory-catalog';
import type { DirectoryHost, DirectoryChildren } from './directory-catalog';

export interface DirectoryTreeOptions {
  root: HTMLElement;
  host: () => Readonly<DirectoryHost> | null;
  request: ApiRequest;
  onPick: (path: string) => void;
}
interface TreeOwner { host: Readonly<DirectoryHost>; events: AbortController }

/** Lazy directory nodes retain the host and mounted tree that produced them. */
export function createDirectoryTree(options: DirectoryTreeOptions) {
  const { root } = options;
  const doc = root.ownerDocument;
  let owner: TreeOwner | null = null;
  function owns(target: TreeOwner): boolean {
    return owner === target && root.isConnected && sameDirectoryHost(target.host, options.host());
  }
  function makeNode(target: TreeOwner, path: string, label: string, depth: number): HTMLElement {
    const node = doc.createElement('div');
    node.className = 'ns-tree-node';
    const row = doc.createElement('div');
    row.className = 'ns-tree-row';
    row.style.paddingLeft = (8 + depth * 16) + 'px';
    row.dataset.path = path;
    const chevron = doc.createElement('span');
    chevron.className = 'ns-tree-chevron';
    chevron.textContent = '▸';
    const name = doc.createElement('span');
    name.className = 'ns-tree-name';
    name.textContent = label;
    const children = doc.createElement('div');
    children.className = 'ns-tree-children';
    children.style.display = 'none';
    let loaded = false;
    chevron.addEventListener('click', event => {
      event.stopPropagation();
      if (!owns(target) || !root.contains(node)) return;
      if (loaded) {
        const open = children.style.display !== 'none';
        children.style.display = open ? 'none' : '';
        chevron.classList.toggle('open', !open);
        return;
      }
      loaded = true;
      node.dataset.loaded = '1';
      chevron.classList.add('open');
      children.style.display = '';
      const pending = doc.createElement('div');
      pending.className = 'ns-tree-empty';
      pending.style.paddingLeft = (8 + (depth + 1) * 16) + 'px';
      pending.textContent = '…';
      children.replaceChildren(pending);
      void load();
    }, { signal: target.events.signal });
    row.addEventListener('click', () => {
      if (!owns(target) || !root.contains(node)) return;
      options.onPick(path);
      root.querySelectorAll('.ns-tree-row.selected').forEach(item => item.classList.remove('selected'));
      row.classList.add('selected');
    }, { signal: target.events.signal });
    row.append(chevron, name);
    node.append(row, children);
    async function load(): Promise<void> {
      let data: DirectoryChildren = { dirs: [], error: true };
      try {
        const response = await options.request(target.host, '/api/dirs/children?path=' + encodeURIComponent(path), { signal: target.events.signal });
        if (!owns(target) || !root.contains(node)) return;
        data = decodeDirectoryChildren(await response.json());
      } catch {} // The existing tree reports unreadable directories in place.
      if (!owns(target) || !root.contains(node)) return;
      children.replaceChildren();
      if (!data.dirs.length) {
        const empty = doc.createElement('div');
        empty.className = 'ns-tree-empty';
        empty.style.paddingLeft = (8 + (depth + 1) * 16) + 'px';
        empty.textContent = data.error ? '(unreadable)' : '(empty)';
        children.appendChild(empty);
        return;
      }
      for (const child of data.dirs) children.appendChild(makeNode(target, child.path, child.name, depth + 1));
    }
    return node;
  }
  function dispose(): void { owner?.events.abort(); owner = null; }
  function reset(): void {
    dispose();
    root.replaceChildren();
    const host = options.host();
    if (!host) return;
    owner = { host: Object.freeze({ ...host }), events: new AbortController() };
    root.appendChild(makeNode(owner, '~', '~', 0));
  }
  return { reset, dispose };
}
