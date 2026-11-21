/**
 * `/api/bots`: the registry as the user and the bots see it. Every change made
 * here writes a revision naming who made it: the user, or the bot and the turn
 * it made the change in. Restoring an old revision writes a new one. A host
 * whose Node lacks `node:sqlite` answers 501.
 */
import type { RouteHandler } from './http-boundary';
import { errorMessage, requestBody } from './http-boundary';
import { validateBotPatch, type BotPatch, type BotRegistry, type BotRow, type RoomMessage } from './bot-registry';
import { record as isRecord } from './helper-values';

/** A message handed to a running bot: a room post, a question from another family, or the answer to one. */
export interface BotDelivery {
  kind: 'room' | 'ask' | 'answer';
  /** Delivers it once, however often it is sent. */
  requestId: string;
  /** What the bot reads. */
  text: string;
  /** The chain and hop the bot's own posts in the turn it wakes continue from. */
  data: { chain: string; hop: number; from: string; fromName: string } & Record<string, string | number>;
}

/** Starting, stopping and reaching a bot's relay; start and stop are no-ops where bots are switched off. */
export interface BotControl {
  start(bot: BotRow): Promise<void>;
  stop(bot: BotRow): Promise<void>;
  /** The bot's session route, which the session list and the browser name it by. */
  route(id: string): string;
  /** Hands a message to the bot's relay; false when it is not running. */
  deliver(bot: BotRow, delivery: BotDelivery): Promise<boolean>;
  /** Whether the bot's relay runs, and when the bot last answered (ISO), from its transcript. */
  state(bot: BotRow): { running: boolean; lastTurnAt: string | null };
}

/** A bot as the `bots` tool lists it: the registry row without its identity, how it stands to the caller, and whether it runs. */
export interface RosterBot extends Omit<BotRow, 'identity' | 'createdAt' | 'updatedAt'> {
  parentName: string | null;
  relation: 'self' | 'ancestor' | 'descendant';
  running: boolean;
  lastTurnAt: string | null;
}

export interface BotHandlers {
  list: RouteHandler;
  create: RouteHandler;
  update: RouteHandler;
  edit: RouteHandler;
  retire: RouteHandler;
  revisions: RouteHandler;
  restore: RouteHandler;
  roster: RouteHandler;
  rosterShow: RouteHandler;
  roomPost: RouteHandler;
  roomRead: RouteHandler;
  ask: RouteHandler;
  answer: RouteHandler;
}

/** A chain of room posts, questions and answers stops here: the post that would be one more is refused. */
export const ROOM_HOP_CAP = 4;

const UNAVAILABLE = 'Bots are off on this host: they run where "bots": true is set in ~/.pi/dish/settings.json and Node has node:sqlite.';
/** The fields a bot may change on itself or a descendant; its own model, parent and status are the user's. */
const BOT_EDITABLE: readonly string[] = ['name', 'identity', 'places', 'thinking', 'model', 'parentId', 'status'];
const NOT_ON_ITSELF: readonly string[] = ['model', 'parentId', 'status'];

/**
 * One line per changed field, as a bot's change is shown in its chat and in a revision: a parent by name, an
 * identity by its length, anything else as JSON.
 */
export function changeLines(fields: readonly string[], before: BotRow | null, after: BotRow, nameOf: (id: string) => string): string[] {
  if (!before) return ['created'];
  return fields.map((field) => {
    if (field === 'parentId') {
      const parent = (row: BotRow) => row.parentId ? nameOf(row.parentId) : '(top level)';
      return `parent: ${parent(before)} → ${parent(after)}`;
    }
    const show = (row: BotRow) => field === 'identity' ? `${row.identity.length} characters` : JSON.stringify(row[field as keyof BotRow]);
    return `${field}: ${show(before)} → ${show(after)}`;
  });
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** The chain a post continues and its hop, or why the body does not name them. */
function chainOf(body: Record<string, unknown>): { chain: string; hop: number } | string {
  const chain = optionalText(body.chain);
  if (!chain) return 'chain must name the turn that started the chain';
  if (typeof body.hop !== 'number' || !Number.isInteger(body.hop) || body.hop < 1) return 'hop must be a whole number from 1';
  return { chain, hop: body.hop };
}

function capRefusal(chain: string): string {
  return `Refused: this chain of bot messages, started by turn ${chain}, has reached ${ROOM_HOP_CAP} hops, the cap. Do not post or ask again for it; if something is left open, tell the user instead.`;
}

export function createBotHandlers(registry: () => BotRegistry | null, control: BotControl): BotHandlers {
  /** A room message as a bot reads it, with names for ids. */
  function readable(bots: BotRegistry, message: RoomMessage) {
    const name = (id: string) => bots.get(id)?.name ?? id;
    return { ...message, fromName: name(message.from), toNames: message.to.map(name) };
  }

  /**
   * Starts or stops the relay a change calls for: a retired bot stops, a bot brought back starts, and a model change
   * takes a new relay, since the model is fixed when the runtime opens. The change is recorded either way; a relay
   * that does not follow answers 502 with what was changed.
   */
  async function applied(res: Parameters<RouteHandler>[1], before: BotRow, after: BotRow, payload: Record<string, unknown>): Promise<void> {
    try {
      if (after.status === 'retired' && before.status !== 'retired') await control.stop(before);
      else if (after.status === 'active' && before.status !== 'active') await control.start(after);
      else if (after.status === 'active' && before.model !== after.model) {
        await control.stop(before);
        await control.start(after);
      }
    } catch (error) {
      const verb = after.status === 'retired' ? 'its relay did not stop' : 'it did not start';
      res.status(502).json({ ...payload, error: `Changed ${after.name}, but ${verb}: ${errorMessage(error)}` });
      return;
    }
    res.json(payload);
  }

  /** The bots `viewer` may see: itself, its ancestors and its descendants, retired ones included. */
  function roster(bots: BotRegistry, viewer: string): RosterBot[] {
    const above = bots.lineage(viewer);
    const all = bots.list();
    const name = (id: string) => all.find(row => row.id === id)?.name ?? id;
    return all.flatMap((row): RosterBot[] => {
      const relation = row.id === viewer ? 'self' : above.includes(row.id) ? 'ancestor' : bots.lineage(row.id).includes(viewer) ? 'descendant' : null;
      if (!relation) return [];
      const { identity: _identity, createdAt: _created, updatedAt: _updated, ...entry } = row;
      return [{ ...entry, parentName: row.parentId ? name(row.parentId) : null, relation, ...control.state(row) }];
    });
  }

  return {
    list(_req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      res.json({ bots: bots.list().map(bot => ({ ...bot, sessionId: control.route(bot.id) })) });
    },
    async create(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      const body = requestBody(req);
      const by = optionalText(body.by);
      if (by && !bots.get(by)) return res.status(404).json({ error: `No bot ${by}` });
      let bot: BotRow;
      try {
        bot = bots.create({
          id: optionalText(body.id), parentId: optionalText(body.parentId) ?? null,
          name: String(body.name ?? ''), identity: String(body.identity ?? ''),
          model: optionalText(body.model), thinking: optionalText(body.thinking) ?? null,
          places: body.places === undefined ? [] : validateBotPatch({ places: body.places }).places,
        }, by ? { actor: by, turn: optionalText(body.turn) ?? null } : { actor: 'user' });
      } catch (error) {
        return res.status(400).json({ error: errorMessage(error) });
      }
      try {
        await control.start(bot);
      } catch (error) {
        return res.status(502).json({ bot, error: `Created ${bot.name}, but it did not start: ${errorMessage(error)}` });
      }
      res.status(201).json({ bot });
    },
    async update(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      const before = bots.get(req.params.id);
      if (!before) return res.status(404).json({ error: 'Bot not found' });
      let changed: { bot: BotRow; moved: BotRow[] };
      try {
        changed = bots.change(req.params.id, requestBody(req), { actor: 'user' });
      } catch (error) {
        return res.status(400).json({ error: errorMessage(error) });
      }
      await applied(res, before, changed.bot, changed);
    },
    /**
     * A bot's own change: `by` is the bot making it, which must be the bot itself or an ancestor. Its own model,
     * parent and status are the user's; a descendant may move only within `by`'s own subtree.
     */
    async edit(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      const before = bots.get(req.params.id);
      if (!before) return res.status(404).json({ error: 'Bot not found' });
      const body = requestBody(req);
      const by = optionalText(body.by);
      if (!by || !bots.get(by)) return res.status(400).json({ error: 'by must name the bot making the change' });
      if (!bots.lineage(before.id).includes(by)) {
        return res.status(403).json({ error: `Refused: ${before.name} is not you or one of your descendants.` });
      }
      const changes = isRecord(body.changes) ? body.changes : {};
      const refused = Object.keys(changes).filter(field => !BOT_EDITABLE.includes(field));
      if (refused.length) return res.status(400).json({ error: `A bot cannot change ${refused.join(', ')}; it may change ${BOT_EDITABLE.join(', ')}.` });
      if (by === before.id && changes.model !== undefined) {
        return res.status(403).json({ error: 'Refused: you cannot change your own model. Tell the user: they can change it with "edit" on your row in the Bots list.' });
      }
      const own = NOT_ON_ITSELF.filter(field => by === before.id && changes[field] !== undefined);
      if (own.length) {
        return res.status(403).json({ error: `Refused: you cannot change your own ${own.map(field => field === 'parentId' ? 'parent' : field).join(' or ')}. Only the user can, from the Bots list.` });
      }
      if (changes.status !== undefined && changes.status !== 'retired' && changes.status !== 'active') {
        return res.status(400).json({ error: 'A bot sets status to "retired" (retire) or "active" (bring back).' });
      }
      if (changes.parentId !== undefined) {
        const parent = typeof changes.parentId === 'string' ? bots.get(changes.parentId) : null;
        if (!parent || !bots.lineage(parent.id).includes(by)) {
          return res.status(403).json({ error: `Refused: a bot can move ${before.name} only under itself or one of its own descendants.` });
        }
      }
      let changed: { bot: BotRow; moved: BotRow[] };
      try {
        changed = bots.change(before.id, changes as BotPatch, { actor: by, turn: optionalText(body.turn) ?? null });
      } catch (error) {
        return res.status(400).json({ error: errorMessage(error) });
      }
      const { bot, moved } = changed;
      const fields = bot.revision === before.revision ? [] : bots.revisions(bot.id).at(-1)!.fields;
      const name = (id: string) => bots.get(id)?.name ?? id;
      const lines = changeLines(fields, before, bot, name);
      await applied(res, before, bot, {
        bot, revision: bot.revision, fields, before, lines,
        moved: moved.map(row => ({ id: row.id, name: row.name, parentId: row.parentId, parentName: row.parentId ? name(row.parentId) : null })),
      });
    },
    async retire(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      const current = bots.get(req.params.id);
      if (!current) return res.status(404).json({ error: 'Bot not found' });
      if (current.status === 'retired') return res.status(409).json({ error: `${current.name} is already retired` });
      const result = bots.retire(current.id, { actor: 'user' });
      await applied(res, current, result.bot, result);
    },
    revisions(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      if (!bots.get(req.params.id)) return res.status(404).json({ error: 'Bot not found' });
      res.json({ revisions: bots.revisions(req.params.id) });
    },
    /** `fields` limits the restore to what one change touched: the chat's undo. */
    async restore(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      const before = bots.get(req.params.id);
      if (!before) return res.status(404).json({ error: 'Bot not found' });
      const { revision, fields } = requestBody(req);
      if (typeof revision !== 'number' || !Number.isInteger(revision)) return res.status(400).json({ error: 'revision must be an integer' });
      if (fields !== undefined && !(Array.isArray(fields) && fields.every(field => typeof field === 'string'))) {
        return res.status(400).json({ error: 'fields must be a list of field names' });
      }
      if (!bots.revisions(before.id).some(row => row.revision === revision)) return res.status(404).json({ error: `${before.name} has no revision ${revision}` });
      let bot: BotRow;
      try {
        bot = bots.restore(before.id, revision, { actor: 'user' }, fields);
      } catch (error) {
        return res.status(400).json({ error: errorMessage(error) });
      }
      await applied(res, before, bot, { bot });
    },
    /** The bots `:id` may see, as its `bots` tool lists them. */
    roster(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      if (!bots.get(req.params.id)) return res.status(404).json({ error: 'Bot not found' });
      res.json({ bots: roster(bots, req.params.id) });
    },
    /** One bot `:id` may see, by id or name: its whole entry and its revisions, each with what it changed. */
    rosterShow(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      if (!bots.get(req.params.id)) return res.status(404).json({ error: 'Bot not found' });
      const wanted = String(req.params.bot ?? '').trim();
      const seen = roster(bots, req.params.id);
      const matches = seen.filter(row => row.id === wanted || row.name.toLowerCase() === wanted.toLowerCase());
      const found = matches.find(row => row.status !== 'retired') ?? matches[0];
      if (!found) return res.status(404).json({ error: `No bot "${wanted}" among the bots you can see: ${seen.map(row => row.name).join(', ')}.` });
      const row = bots.get(found.id)!;
      const name = (id: string) => bots.get(id)?.name ?? id;
      res.json({
        bot: { ...found, identity: row.identity, createdAt: row.createdAt, updatedAt: row.updatedAt },
        revisions: bots.revisions(row.id).map(revision => ({
          revision: revision.revision, by: revision.actor === 'user' || revision.actor === 'pi-dish' ? revision.actor : name(revision.actor),
          turn: revision.turn, fields: revision.fields, at: revision.createdAt,
          changes: changeLines(revision.fields, revision.before, revision.after, name),
        })),
      });
    },
    /** `:id` posts to its family's room; only the bots named in `to` are woken. */
    async roomPost(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      const sender = bots.get(req.params.id);
      if (!sender) return res.status(404).json({ error: 'Bot not found' });
      const body = requestBody(req);
      const chain = chainOf(body);
      if (typeof chain === 'string') return res.status(400).json({ error: chain });
      if (chain.hop > ROOM_HOP_CAP) return res.status(409).json({ error: capRefusal(chain.chain) });
      const text = optionalText(body.text);
      if (!text) return res.status(400).json({ error: 'text must be the message' });
      const family = bots.lineage(sender.id).at(-1)!;
      const members = bots.family(family).filter(bot => bot.id !== sender.id);
      const wanted = Array.isArray(body.to) ? body.to.map(String) : [];
      const recipients = wanted.map(name => members.find(bot => bot.id === name || bot.name.toLowerCase() === name.trim().toLowerCase()));
      const unknown = wanted.filter((_, index) => !recipients[index]);
      if (!wanted.length || unknown.length) {
        return res.status(400).json({ error: `${unknown.length ? `Not in your family: ${unknown.join(', ')}. ` : 'Name the bots the message is for. '}Your family: ${members.map(bot => bot.name).join(', ') || 'no other bots'}.` });
      }
      const to = [...new Map(recipients.map(bot => [bot!.id, bot!])).values()];
      const message = bots.post({ family, from: sender.id, to: to.map(bot => bot.id), text, ...chain });
      const delivered: string[] = [];
      const notRunning: string[] = [];
      for (const bot of to) {
        const ok = await control.deliver(bot, {
          kind: 'room', requestId: `room:${message.id}`,
          text: `[room] ${sender.name} to ${to.map(row => row.name).join(', ')}: ${text}\n(Room message ${message.id}, hop ${chain.hop} of at most ${ROOM_HOP_CAP}. Reply with room_post only if ${sender.name} needs an answer.)`,
          data: { ...chain, from: sender.id, fromName: sender.name, messageId: message.id },
        }).catch(() => false);
        (ok ? delivered : notRunning).push(bot.name);
      }
      res.json({ message: readable(bots, message), delivered, notRunning });
    },
    /** The newest messages of `:id`'s family's room. */
    roomRead(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      if (!bots.get(req.params.id)) return res.status(404).json({ error: 'Bot not found' });
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      res.json({ messages: bots.room(bots.lineage(req.params.id).at(-1)!, limit).map(message => readable(bots, message)) });
    },
    /** `by` puts one question to `:id`, a bot in another family; the answer comes back once through `answer`. */
    async ask(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      const target = bots.get(req.params.id);
      const body = requestBody(req);
      const asker = bots.get(String(body.by ?? ''));
      if (!target || target.status === 'retired' || !asker) return res.status(404).json({ error: 'Bot not found' });
      const chain = chainOf(body);
      if (typeof chain === 'string') return res.status(400).json({ error: chain });
      if (chain.hop > ROOM_HOP_CAP) return res.status(409).json({ error: capRefusal(chain.chain) });
      const question = optionalText(body.question);
      const askId = optionalText(body.askId);
      if (!question || !askId) return res.status(400).json({ error: 'question and askId are required' });
      if (bots.lineage(target.id).at(-1) === bots.lineage(asker.id).at(-1)) {
        return res.status(400).json({ error: `${target.name} is in your family: use room_post to reach it.` });
      }
      const delivered = await control.deliver(target, {
        kind: 'ask', requestId: `ask:${askId}`,
        text: `[question from ${asker.name}, a bot in another family] ${question}\n(Answer it in this turn: your final reply goes back to ${asker.name} once.)`,
        data: { ...chain, from: asker.id, fromName: asker.name, askId, question },
      }).catch(() => false);
      if (!delivered) return res.status(409).json({ error: `${target.name} is not running, so it cannot be asked now.` });
      res.json({ delivered: true, target: target.name });
    },
    /** `by` answers the question `askId` that `:id` asked it. */
    async answer(req, res) {
      const bots = registry();
      if (!bots) return res.status(501).json({ error: UNAVAILABLE });
      const asker = bots.get(req.params.id);
      const body = requestBody(req);
      const answerer = bots.get(String(body.by ?? ''));
      if (!asker || !answerer) return res.status(404).json({ error: 'Bot not found' });
      const chain = chainOf(body);
      if (typeof chain === 'string') return res.status(400).json({ error: chain });
      const askId = optionalText(body.askId);
      if (!askId) return res.status(400).json({ error: 'askId is required' });
      const text = optionalText(body.text) ?? '(no answer text)';
      const question = optionalText(body.question);
      const delivered = await control.deliver(asker, {
        kind: 'answer', requestId: `answer:${askId}`,
        text: `[answer from ${answerer.name}]${question ? ` to your question "${question}"` : ''}: ${text}`,
        data: { ...chain, from: answerer.id, fromName: answerer.name, askId },
      }).catch(() => false);
      if (!delivered) return res.status(409).json({ error: `${asker.name} is not running; the answer was not delivered.` });
      res.json({ delivered: true });
    },
  };
}
