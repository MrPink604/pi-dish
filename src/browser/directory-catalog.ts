import type { ApiRequest, HostEndpoint } from './api-client';

/** Identity and route travel together; null means a selected host is unavailable. */
export interface DirectoryHost extends HostEndpoint { readonly hostId: string | null }
export interface KnownDirectory { readonly path: string; readonly short: string }
export interface DirectoryChild { readonly path: string; readonly name: string }
export interface DirectoryChildren { readonly dirs: readonly DirectoryChild[]; readonly error: boolean }
export function sameDirectoryHost(a: Readonly<DirectoryHost> | null, b: Readonly<DirectoryHost> | null): boolean {
  return !!a && !!b && a.hostId === b.hostId && a.base === b.base && a.token === b.token;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function decodeKnownDirectories(value: unknown): KnownDirectory[] {
  if (!Array.isArray(value)) return [];
  const rows: unknown[] = value;
  return rows.flatMap(row => record(row) && typeof row.path === 'string' && typeof row.short === 'string'
    ? [{ path: row.path, short: row.short }] : []);
}
export function decodeDirectoryChildren(value: unknown): DirectoryChildren {
  if (!record(value)) return { dirs: [], error: true };
  const rows: unknown[] = Array.isArray(value.dirs) ? value.dirs : [];
  return { dirs: rows.flatMap(row => record(row) && typeof row.path === 'string' && typeof row.name === 'string'
    ? [{ path: row.path, name: row.name }] : []), error: !!value.error };
}

/** A selected host's known paths may never become another host's suggestions. */
export function createDirectoryCatalog(options: {
  host: () => Readonly<DirectoryHost> | null;
  request: ApiRequest;
}) {
  let sequence = 0;
  let owner: Readonly<DirectoryHost> | null = null;
  let rows: readonly KnownDirectory[] = [];
  function current(): readonly KnownDirectory[] {
    return sameDirectoryHost(owner, options.host()) ? rows : [];
  }
  function retire(): void { sequence++; }
  async function load(): Promise<void> {
    const requestSequence = ++sequence;
    const selected = options.host();
    if (!selected) return;
    const host = Object.freeze({ ...selected });
    const owns = () => requestSequence === sequence && sameDirectoryHost(host, options.host());
    try {
      const response = await options.request(host, '/api/cwds');
      if (!response.ok || !owns()) return;
      const data: unknown = await response.json();
      if (!owns()) return;
      rows = decodeKnownDirectories(data);
      owner = host;
    } catch {} // Keep this host's existing rows after a failed refresh.
  }
  return { current, load, retire };
}
