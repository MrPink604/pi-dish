/**
 * The bot registry: `~/.pi/dish/bots.sqlite`, one current row per bot plus an
 * append-only revision log. pi-dish owns the file; a bot's relay opens it to
 * read its own row.
 *
 * `node:sqlite` is loaded on first use, never at import: pi-dish also runs on a
 * Node build without it, where `botRegistryAvailable()` is false and no bot
 * starts.
 */
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import type * as NodeSqlite from 'node:sqlite';
import { dishDir } from './dish-store';
import { record as isRecord } from './helper-values';

export type BotStatus = 'active' | 'paused' | 'retired';

/** Where a bot does its work; the label is what the bot calls it. */
export interface BotPlace {
  host: string | null;
  cwd: string;
  label: string;
}

export interface BotRow {
  id: string;
  parentId: string | null;
  name: string;
  status: BotStatus;
  /** `provider/model-id`, resolved through Pi's model layer. */
  model: string;
  thinking: string | null;
  identity: string;
  places: BotPlace[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** The fields an edit may change; identity fields and bookkeeping are fixed. */
export type BotPatch = Partial<Pick<BotRow, 'name' | 'status' | 'model' | 'thinking' | 'identity' | 'places' | 'parentId'>>;

export interface BotRevision {
  botId: string;
  revision: number;
  /** `user`, or the id of the bot that made the change. */
  actor: string;
  /** The turn a bot made the change in; null for the user. */
  turn: string | null;
  fields: string[];
  before: BotRow | null;
  after: BotRow;
  createdAt: string;
}

export interface ChangeSource {
  actor: string;
  turn?: string | null;
}

/** What a new bot is made from; the model defaults to Opus, the id to a fresh one. */
export interface NewBot {
  /** Given by a caller that may retry, so a retry finds the bot it made. */
  id?: string;
  parentId?: string | null;
  name: string;
  identity: string;
  model?: string;
  thinking?: string | null;
  places?: BotPlace[];
}

/** A top-level bot is at depth 1; a bot below this depth is refused. */
export const MAX_BOT_DEPTH = 3;

export interface BotRegistry {
  readonly file: string;
  list(): BotRow[];
  get(id: string): BotRow | null;
  /** Creates Fleet unless a bot of that name exists; returns it either way. */
  seedFleet(): BotRow;
  /** Creates an active bot with its first revision; an id that exists returns that bot unchanged. */
  create(input: NewBot, source: ChangeSource): BotRow;
  update(id: string, patch: BotPatch, source: ChangeSource): BotRow;
  /** Archives a bot and moves its children up to its parent, each move a revision of the child. */
  retire(id: string, source: ChangeSource): { bot: BotRow; moved: BotRow[] };
  /** The ids from a bot up to its top-level ancestor, the bot first; its length is the bot's depth. */
  lineage(id: string): string[];
  revisions(id: string): BotRevision[];
  /** Puts an old revision's row back as a new revision: every editable field, or only `fields`. */
  restore(id: string, revision: number, source: ChangeSource, fields?: readonly string[]): BotRow;
  close(): void;
}

export const DEFAULT_BOT_MODEL = 'claude-code/claude-opus-5-5';

export const FLEET_IDENTITY = [
  'You are Fleet, the standing contact for the hosts in the user\'s fleet of machines.',
  'You know which hosts exist, what each is for, and how healthy they are. Learn them from the',
  '`sessions` tool (`hosts` and `load`), keep what you learn in your notebook, and refresh it when',
  'it may be stale. When the user asks for something to be checked, fixed or set up on a host, start',
  'a worker on that host with `spawn_worker`, tell the user its ref, and relay its findings when',
  'its report arrives. Prefer one well-briefed worker over several vague ones. Keep replies short.',
].join('\n');

const PATCH_FIELDS: readonly (keyof BotPatch)[] = ['name', 'status', 'model', 'thinking', 'identity', 'places', 'parentId'];
const STATUSES: readonly BotStatus[] = ['active', 'paused', 'retired'];

function registryFile(): string {
  return path.join(dishDir(), 'bots.sqlite');
}

type SqliteModule = typeof NodeSqlite;

function loadSqlite(): SqliteModule {
  // `process.getBuiltinModule` loads the builtin without a static import, so
  // requiring this module never fails on a Node build that lacks it.
  const sqlite = process.getBuiltinModule('node:sqlite');
  if (!sqlite) throw new Error('node:sqlite is not available in this Node build');
  return sqlite;
}

/** True where this Node build can open the registry. */
export function botRegistryAvailable(): boolean {
  try { loadSqlite(); return true; } catch { return false; }
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
  if (value.length > max) throw new TypeError(`${field} must be at most ${max} characters`);
  return value;
}

function places(value: unknown): BotPlace[] {
  if (!Array.isArray(value)) throw new TypeError('places must be a list');
  return value.map((place: unknown) => {
    if (!isRecord(place)) throw new TypeError('each place must be an object');
    const host = place.host === null || place.host === undefined || place.host === '' ? null : text(place.host, 'place.host', 200);
    return { host, cwd: text(place.cwd, 'place.cwd', 4096), label: text(place.label, 'place.label', 200) };
  });
}

/** Validates an edit; unknown fields are refused so a typo never passes silently. */
export function validateBotPatch(input: unknown): BotPatch {
  if (!isRecord(input)) throw new TypeError('a bot edit must be an object');
  const unknown = Object.keys(input).filter(key => !(PATCH_FIELDS as readonly string[]).includes(key));
  if (unknown.length) throw new TypeError(`unknown bot fields: ${unknown.join(', ')}`);
  const patch: BotPatch = {};
  if (input.name !== undefined) patch.name = text(input.name, 'name', 80);
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status as BotStatus)) throw new TypeError(`status must be one of ${STATUSES.join(', ')}`);
    patch.status = input.status as BotStatus;
  }
  if (input.model !== undefined) {
    const model = text(input.model, 'model', 200);
    if (!/^[^/\s]+\/\S+$/.test(model)) throw new TypeError('model must be provider/model-id');
    patch.model = model;
  }
  if (input.thinking !== undefined) patch.thinking = input.thinking === null ? null : text(input.thinking, 'thinking', 40);
  if (input.identity !== undefined) patch.identity = text(input.identity, 'identity', 64 * 1024);
  if (input.places !== undefined) patch.places = places(input.places);
  if (input.parentId !== undefined) patch.parentId = input.parentId === null ? null : text(input.parentId, 'parentId', 200);
  return patch;
}

interface BotRecord {
  id: string; parent_id: string | null; name: string; status: string; model: string; thinking: string | null;
  identity: string; places: string; revision: number; created_at: string; updated_at: string;
}

function rowOf(raw: unknown): BotRow {
  const value = raw as BotRecord;
  return {
    id: value.id,
    parentId: value.parent_id,
    name: value.name,
    status: value.status as BotStatus,
    model: value.model,
    thinking: value.thinking,
    identity: value.identity,
    places: JSON.parse(value.places) as BotPlace[],
    revision: value.revision,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES bots(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  model TEXT NOT NULL,
  thinking TEXT,
  identity TEXT NOT NULL,
  places TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bot_revisions (
  bot_id TEXT NOT NULL REFERENCES bots(id),
  revision INTEGER NOT NULL,
  actor TEXT NOT NULL,
  turn TEXT,
  fields TEXT NOT NULL,
  before TEXT,
  after TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (bot_id, revision)
);
`;

/** Opens (and creates) the registry. `readOnly` opens never create or write. */
export function openBotRegistry(file: string = registryFile(), { readOnly = false } = {}): BotRegistry {
  const { DatabaseSync: Database } = loadSqlite();
  if (!readOnly) fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db: NodeSqlite.DatabaseSync = new Database(file, { readOnly });
  db.exec('PRAGMA busy_timeout = 5000');
  if (!readOnly) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(SCHEMA);
  }

  function get(id: string): BotRow | null {
    const raw = db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
    return raw ? rowOf(raw) : null;
  }

  function writeRevision(before: BotRow | null, after: BotRow, fields: string[], source: ChangeSource): void {
    db.prepare(`INSERT INTO bot_revisions (bot_id, revision, actor, turn, fields, before, after, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      after.id, after.revision, text(source.actor, 'actor', 200), source.turn ?? null, JSON.stringify(fields),
      before ? JSON.stringify(before) : null, JSON.stringify(after), after.updatedAt);
  }

  function store(row: BotRow): void {
    db.prepare(`INSERT INTO bots (id, parent_id, name, status, model, thinking, identity, places, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name, status = excluded.status,
        model = excluded.model, thinking = excluded.thinking, identity = excluded.identity, places = excluded.places,
        revision = excluded.revision, updated_at = excluded.updated_at`).run(
      row.id, row.parentId, row.name, row.status, row.model, row.thinking, row.identity, JSON.stringify(row.places),
      row.revision, row.createdAt, row.updatedAt);
  }

  function transaction<T>(work: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function lineage(id: string): string[] {
    const ids: string[] = [];
    for (let current = get(id); current; current = current.parentId ? get(current.parentId) : null) {
      if (ids.includes(current.id)) throw new Error(`bot ${id} has a cycle in its parents`);
      ids.push(current.id);
    }
    return ids;
  }

  /** One change inside an open transaction; an unchanged row writes nothing. */
  function applyIn(id: string, change: (current: BotRow) => BotRow, source: ChangeSource): BotRow {
    const before = get(id);
    if (!before) throw new Error(`no bot ${id}`);
    const proposed = change(before);
    const fields = PATCH_FIELDS.filter(field => JSON.stringify(proposed[field]) !== JSON.stringify(before[field]));
    if (!fields.length) return before;
    const after: BotRow = { ...proposed, id, createdAt: before.createdAt, revision: before.revision + 1, updatedAt: new Date().toISOString() };
    store(after);
    writeRevision(before, after, fields, source);
    return after;
  }

  function apply(id: string, change: (current: BotRow) => BotRow, source: ChangeSource): BotRow {
    return transaction(() => applyIn(id, change, source));
  }

  return {
    file,
    // rowid keeps creation order where two bots share a millisecond.
    list: () => db.prepare('SELECT * FROM bots ORDER BY rowid').all().map(rowOf),
    get,
    seedFleet() {
      return transaction(() => {
        const existing = db.prepare('SELECT * FROM bots WHERE name = ? COLLATE NOCASE').get('Fleet');
        if (existing) return rowOf(existing);
        const now = new Date().toISOString();
        const row: BotRow = {
          id: crypto.randomUUID(), parentId: null, name: 'Fleet', status: 'active', model: DEFAULT_BOT_MODEL,
          thinking: null, identity: FLEET_IDENTITY, places: [], revision: 1, createdAt: now, updatedAt: now,
        };
        store(row);
        writeRevision(null, row, [...PATCH_FIELDS], { actor: 'pi-dish' });
        return row;
      });
    },
    create(input, source) {
      const valid = validateBotPatch({
        name: input.name, identity: input.identity, model: input.model ?? DEFAULT_BOT_MODEL,
        thinking: input.thinking ?? null, places: input.places ?? [],
      });
      const id = input.id ?? crypto.randomUUID();
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new TypeError('id must be a UUID');
      return transaction(() => {
        const existing = get(id);
        if (existing) return existing;
        const parentId = input.parentId ?? null;
        if (parentId !== null) {
          const parent = get(parentId);
          if (!parent || parent.status === 'retired') throw new Error(`no active bot ${parentId} to be the parent`);
          const depth = lineage(parentId).length + 1;
          if (depth > MAX_BOT_DEPTH) {
            throw new Error(`Refused: ${parent.name} is already ${depth - 1} levels deep, and bots nest at most ${MAX_BOT_DEPTH} levels. Give this work to ${parent.name} or one of its ancestors instead.`);
          }
        }
        const now = new Date().toISOString();
        const row: BotRow = {
          id, parentId, name: valid.name!, status: 'active', model: valid.model!, thinking: valid.thinking ?? null,
          identity: valid.identity!, places: valid.places ?? [], revision: 1, createdAt: now, updatedAt: now,
        };
        store(row);
        writeRevision(null, row, [...PATCH_FIELDS], source);
        return row;
      });
    },
    update(id, patch, source) {
      const valid = validateBotPatch(patch);
      return apply(id, current => ({ ...current, ...valid }), source);
    },
    retire(id, source) {
      return transaction(() => {
        const current = get(id);
        if (!current) throw new Error(`no bot ${id}`);
        const children = db.prepare("SELECT * FROM bots WHERE parent_id = ? AND status != 'retired' ORDER BY rowid").all(id).map(rowOf);
        const moved = children.map(child => applyIn(child.id, row => ({ ...row, parentId: current.parentId }), source));
        const bot = applyIn(id, row => ({ ...row, status: 'retired' }), source);
        return { bot, moved };
      });
    },
    lineage,
    revisions(id) {
      return db.prepare('SELECT * FROM bot_revisions WHERE bot_id = ? ORDER BY revision').all(id).map((raw) => {
        const value = raw as Record<string, string | number | null>;
        return {
          botId: String(value.bot_id),
          revision: Number(value.revision),
          actor: String(value.actor),
          turn: value.turn === null ? null : String(value.turn),
          fields: JSON.parse(String(value.fields)) as string[],
          before: value.before === null ? null : JSON.parse(String(value.before)) as BotRow,
          after: JSON.parse(String(value.after)) as BotRow,
          createdAt: String(value.created_at),
        };
      });
    },
    restore(id, revision, source, fields) {
      const raw = db.prepare('SELECT after FROM bot_revisions WHERE bot_id = ? AND revision = ?').get(id, revision);
      if (!raw) throw new Error(`bot ${id} has no revision ${revision}`);
      const old = JSON.parse(String(raw.after)) as BotRow;
      const patch: BotPatch = {};
      for (const field of PATCH_FIELDS) if (!fields || fields.includes(field)) Object.assign(patch, { [field]: old[field] });
      return apply(id, current => ({ ...current, ...patch }), source);
    },
    close: () => db.close(),
  };
}
