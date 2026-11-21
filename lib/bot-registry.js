// Generated from src/core/bot-registry.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOTS_SETTING = exports.FLEET_IDENTITY = exports.DEFAULT_BOT_MODEL = exports.MAX_BOT_DEPTH = void 0;
exports.botRegistryAvailable = botRegistryAvailable;
exports.validateBotPatch = validateBotPatch;
exports.openBotRegistry = openBotRegistry;
/**
 * The bot registry: `~/.pi/dish/bots.sqlite`, one current row per bot plus an
 * append-only revision log. pi-dish owns the file; a bot's relay opens it to
 * read its own row.
 *
 * `node:sqlite` is loaded on first use, never at import: pi-dish also runs on a
 * Node build without it, where `botRegistryAvailable()` is false and no bot
 * starts.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dish_store_1 = require("./dish-store");
const helper_values_1 = require("./helper-values");
/** A top-level bot is at depth 1; a bot below this depth is refused. */
exports.MAX_BOT_DEPTH = 3;
exports.DEFAULT_BOT_MODEL = 'claude-code/claude-opus-5-5';
exports.FLEET_IDENTITY = [
    'You are Fleet, the standing contact for the hosts in the user\'s fleet of machines.',
    'You know which hosts exist, what each is for, and how healthy they are. Learn them from the',
    '`sessions` tool (`hosts` and `load`), keep what you learn in your notebook, and refresh it when',
    'it may be stale. When the user asks for something to be checked, fixed or set up on a host, start',
    'a worker on that host with `spawn_worker`, tell the user its ref, and relay its findings when',
    'its report arrives. Prefer one well-briefed worker over several vague ones. Keep replies short.',
].join('\n');
const PATCH_FIELDS = ['name', 'status', 'model', 'thinking', 'identity', 'places', 'parentId'];
const STATUSES = ['active', 'paused', 'retired'];
function registryFile() {
    return path.join((0, dish_store_1.dishDir)(), 'bots.sqlite');
}
function loadSqlite() {
    // `process.getBuiltinModule` loads the builtin without a static import, so
    // requiring this module never fails on a Node build that lacks it.
    const sqlite = process.getBuiltinModule('node:sqlite');
    if (!sqlite)
        throw new Error('node:sqlite is not available in this Node build');
    return sqlite;
}
/** The key in `~/.pi/dish/settings.json` that turns bots on for this host; they are off without it. */
exports.BOTS_SETTING = 'bots';
/** True where this Node build can open the registry. */
function botRegistryAvailable() {
    try {
        loadSqlite();
        return true;
    }
    catch {
        return false;
    }
}
function text(value, field, max) {
    if (typeof value !== 'string' || !value.trim())
        throw new TypeError(`${field} must be a non-empty string`);
    if (value.length > max)
        throw new TypeError(`${field} must be at most ${max} characters`);
    return value;
}
function places(value) {
    if (!Array.isArray(value))
        throw new TypeError('places must be a list');
    return value.map((place) => {
        if (!(0, helper_values_1.record)(place))
            throw new TypeError('each place must be an object');
        const host = place.host === null || place.host === undefined || place.host === '' ? null : text(place.host, 'place.host', 200);
        return { host, cwd: text(place.cwd, 'place.cwd', 4096), label: text(place.label, 'place.label', 200) };
    });
}
/** Validates an edit; unknown fields are refused so a typo never passes silently. */
function validateBotPatch(input) {
    if (!(0, helper_values_1.record)(input))
        throw new TypeError('a bot edit must be an object');
    const unknown = Object.keys(input).filter(key => !PATCH_FIELDS.includes(key));
    if (unknown.length)
        throw new TypeError(`unknown bot fields: ${unknown.join(', ')}`);
    const patch = {};
    if (input.name !== undefined)
        patch.name = text(input.name, 'name', 80);
    if (input.status !== undefined) {
        if (!STATUSES.includes(input.status))
            throw new TypeError(`status must be one of ${STATUSES.join(', ')}`);
        patch.status = input.status;
    }
    if (input.model !== undefined) {
        const model = text(input.model, 'model', 200);
        if (!/^[^/\s]+\/\S+$/.test(model))
            throw new TypeError('model must be provider/model-id');
        patch.model = model;
    }
    if (input.thinking !== undefined)
        patch.thinking = input.thinking === null ? null : text(input.thinking, 'thinking', 40);
    if (input.identity !== undefined)
        patch.identity = text(input.identity, 'identity', 64 * 1024);
    if (input.places !== undefined)
        patch.places = places(input.places);
    if (input.parentId !== undefined)
        patch.parentId = input.parentId === null ? null : text(input.parentId, 'parentId', 200);
    return patch;
}
function rowOf(raw) {
    const value = raw;
    return {
        id: value.id,
        parentId: value.parent_id,
        name: value.name,
        status: value.status,
        model: value.model,
        thinking: value.thinking,
        identity: value.identity,
        places: JSON.parse(value.places),
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
CREATE TABLE IF NOT EXISTS room_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipients TEXT NOT NULL,
  text TEXT NOT NULL,
  chain TEXT NOT NULL,
  hop INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS room_messages_family ON room_messages (family, id);
`;
/** Opens (and creates) the registry. `readOnly` opens never create or write. */
function openBotRegistry(file = registryFile(), { readOnly = false } = {}) {
    const { DatabaseSync: Database } = loadSqlite();
    if (!readOnly)
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const db = new Database(file, { readOnly });
    db.exec('PRAGMA busy_timeout = 5000');
    if (!readOnly) {
        db.exec('PRAGMA journal_mode = WAL');
        db.exec(SCHEMA);
    }
    function get(id) {
        const raw = db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
        return raw ? rowOf(raw) : null;
    }
    function writeRevision(before, after, fields, source) {
        db.prepare(`INSERT INTO bot_revisions (bot_id, revision, actor, turn, fields, before, after, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(after.id, after.revision, text(source.actor, 'actor', 200), source.turn ?? null, JSON.stringify(fields), before ? JSON.stringify(before) : null, JSON.stringify(after), after.updatedAt);
    }
    function store(row) {
        db.prepare(`INSERT INTO bots (id, parent_id, name, status, model, thinking, identity, places, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name, status = excluded.status,
        model = excluded.model, thinking = excluded.thinking, identity = excluded.identity, places = excluded.places,
        revision = excluded.revision, updated_at = excluded.updated_at`).run(row.id, row.parentId, row.name, row.status, row.model, row.thinking, row.identity, JSON.stringify(row.places), row.revision, row.createdAt, row.updatedAt);
    }
    function transaction(work) {
        db.exec('BEGIN IMMEDIATE');
        try {
            const result = work();
            db.exec('COMMIT');
            return result;
        }
        catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }
    function lineage(id) {
        const ids = [];
        for (let current = get(id); current; current = current.parentId ? get(current.parentId) : null) {
            if (ids.includes(current.id))
                throw new Error(`bot ${id} has a cycle in its parents`);
            ids.push(current.id);
        }
        return ids;
    }
    /** One change inside an open transaction; an unchanged row writes nothing. */
    function applyIn(id, change, source) {
        const before = get(id);
        if (!before)
            throw new Error(`no bot ${id}`);
        const proposed = change(before);
        const fields = PATCH_FIELDS.filter(field => JSON.stringify(proposed[field]) !== JSON.stringify(before[field]));
        if (!fields.length)
            return before;
        const after = { ...proposed, id, createdAt: before.createdAt, revision: before.revision + 1, updatedAt: new Date().toISOString() };
        store(after);
        writeRevision(before, after, fields, source);
        return after;
    }
    function apply(id, change, source) {
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
                if (existing)
                    return rowOf(existing);
                const now = new Date().toISOString();
                const row = {
                    id: crypto.randomUUID(), parentId: null, name: 'Fleet', status: 'active', model: exports.DEFAULT_BOT_MODEL,
                    thinking: null, identity: exports.FLEET_IDENTITY, places: [], revision: 1, createdAt: now, updatedAt: now,
                };
                store(row);
                writeRevision(null, row, [...PATCH_FIELDS], { actor: 'pi-dish' });
                return row;
            });
        },
        create(input, source) {
            const valid = validateBotPatch({
                name: input.name, identity: input.identity, model: input.model ?? exports.DEFAULT_BOT_MODEL,
                thinking: input.thinking ?? null, places: input.places ?? [],
            });
            const id = input.id ?? crypto.randomUUID();
            if (!/^[0-9a-f-]{36}$/.test(id))
                throw new TypeError('id must be a UUID');
            return transaction(() => {
                const existing = get(id);
                if (existing)
                    return existing;
                const parentId = input.parentId ?? null;
                if (parentId !== null) {
                    const parent = get(parentId);
                    if (!parent || parent.status === 'retired')
                        throw new Error(`no active bot ${parentId} to be the parent`);
                    const depth = lineage(parentId).length + 1;
                    if (depth > exports.MAX_BOT_DEPTH) {
                        throw new Error(`Refused: ${parent.name} is already ${depth - 1} levels deep, and bots nest at most ${exports.MAX_BOT_DEPTH} levels. Give this work to ${parent.name} or one of its ancestors instead.`);
                    }
                }
                const now = new Date().toISOString();
                const row = {
                    id, parentId, name: valid.name, status: 'active', model: valid.model, thinking: valid.thinking ?? null,
                    identity: valid.identity, places: valid.places ?? [], revision: 1, createdAt: now, updatedAt: now,
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
                if (!current)
                    throw new Error(`no bot ${id}`);
                const children = db.prepare("SELECT * FROM bots WHERE parent_id = ? AND status != 'retired' ORDER BY rowid").all(id).map(rowOf);
                const moved = children.map(child => applyIn(child.id, row => ({ ...row, parentId: current.parentId }), source));
                const bot = applyIn(id, row => ({ ...row, status: 'retired' }), source);
                return { bot, moved };
            });
        },
        lineage,
        family(family) {
            return db.prepare("SELECT * FROM bots WHERE status != 'retired' ORDER BY rowid").all().map(rowOf)
                .filter(row => lineage(row.id).at(-1) === family);
        },
        post(message) {
            const createdAt = new Date().toISOString();
            const result = db.prepare('INSERT INTO room_messages (family, sender, recipients, text, chain, hop, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(message.family, message.from, JSON.stringify(message.to), message.text, message.chain, message.hop, createdAt);
            return { ...message, id: Number(result.lastInsertRowid), createdAt };
        },
        room(family, limit) {
            return db.prepare('SELECT * FROM room_messages WHERE family = ? ORDER BY id DESC LIMIT ?').all(family, limit).reverse().map((raw) => {
                const value = raw;
                return {
                    id: Number(value.id), family: String(value.family), from: String(value.sender), to: JSON.parse(String(value.recipients)),
                    text: String(value.text), chain: String(value.chain), hop: Number(value.hop), createdAt: String(value.created_at),
                };
            });
        },
        revisions(id) {
            return db.prepare('SELECT * FROM bot_revisions WHERE bot_id = ? ORDER BY revision').all(id).map((raw) => {
                const value = raw;
                return {
                    botId: String(value.bot_id),
                    revision: Number(value.revision),
                    actor: String(value.actor),
                    turn: value.turn === null ? null : String(value.turn),
                    fields: JSON.parse(String(value.fields)),
                    before: value.before === null ? null : JSON.parse(String(value.before)),
                    after: JSON.parse(String(value.after)),
                    createdAt: String(value.created_at),
                };
            });
        },
        restore(id, revision, source, fields) {
            const raw = db.prepare('SELECT after FROM bot_revisions WHERE bot_id = ? AND revision = ?').get(id, revision);
            if (!raw)
                throw new Error(`bot ${id} has no revision ${revision}`);
            const old = JSON.parse(String(raw.after));
            const patch = {};
            for (const field of PATCH_FIELDS)
                if (!fields || fields.includes(field))
                    Object.assign(patch, { [field]: old[field] });
            return apply(id, current => ({ ...current, ...patch }), source);
        },
        close: () => db.close(),
    };
}
