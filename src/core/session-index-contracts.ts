import type { SessionInfo } from './session-metadata-contracts';
import type { SessionSource } from './session-source-contracts';

/** Catalog-only index port. Usage/search/skills internals are Task 3's own boundary. */
export interface SessionMetadataIndex {
  /** Borrowed observations; consumers must not mutate them or retain them as snapshots. */
  scanSessions(sources: readonly SessionSource[]): {
    infos: ReadonlyMap<string, Readonly<SessionInfo>>;
    indexing: boolean;
  };
  /** Fresh shallow copy, without internal usage/identity fields. Throws on unreadable files. */
  getSessionInfo(source: SessionSource): SessionInfo;
  getSearchText(source: SessionSource): string;
}
