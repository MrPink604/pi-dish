import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FeatureHandler, FeaturePorts, FeatureHandlers } from './feature-handlers';
import * as skillsLib from './skills';
import type { SkillsInventory } from './skills';
import * as sessionIndex from './session-index';
import { finite } from './session-index-data';
import type { SkillActivation } from './session-index-data';
import { runtimeResourcePath } from './runtime-resources';

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

// Distinct project cwds pi-dish knows about — the scope over which skills are
// discovered (global user skills plus every project root).
export function knownWorkspaceCwds(buildSessionCatalog: FeaturePorts['buildSessionCatalog']): string[] {
  const cwds = new Set<string>();
  try {
    for (const session of buildSessionCatalog().list) if (session.cwd) cwds.add(session.cwd);
  } catch {}
  return [...cwds];
}

// Which refinement methodology the button drafts. Env wins over the dish
// setting; a value with a path separator is a markdown file to read, a bare
// token is a pi skill name; unset is the vended default skill.
function resolveRefineConfig(inventory: SkillsInventory, ports: FeaturePorts) {
  const envVal = process.env.PI_DISH_REFINE;
  const settingVal = ports.readDishSettings().refine;
  const raw = (envVal != null && envVal !== '') ? envVal
    : (typeof settingVal === 'string' ? settingVal : '');
  const names = new Set((inventory?.skills || []).map(s => s.name));
  if (raw) {
    if (raw.includes('/') || raw.includes(path.sep)) {
      const abs = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : path.resolve(raw);
      return { mode: 'path', mdPath: abs };
    }
    return { mode: 'skill', skillName: raw, discovered: names.has(raw) };
  }
  return {
    mode: 'default',
    skillName: 'pi-dish-skill-refine',
    discovered: names.has('pi-dish-skill-refine'),
    mdPath: runtimeResourcePath(ports.applicationRoot, 'skills/pi-dish-skill-refine/SKILL.md'),
  };
}

// Weekly activation buckets, most-recent-last, `weeks` long. Zero weeks stay
// as zeros (rendered as --chart-other stubs by the client — never omitted).
function weeklyBuckets(records: readonly SkillActivation[], weeks: number, now = Date.now()): number[] {
  const out = new Array<number>(weeks).fill(0);
  for (const r of records) {
    if (!finite(r.ts)) continue;
    const age = Math.floor((now - r.ts) / WEEK_MS);
    if (age < 0 || age >= weeks) continue;
    out[weeks - 1 - age]++;
  }
  return out;
}

function usageRollup(records: readonly SkillActivation[], now = Date.now()) {
  const cutoff30 = now - 30 * DAY_MS;
  let count30 = 0, lastUsedTs: number | null = null;
  const kindSplit = { read: 0, targeted: 0, explicit: 0 };
  const sessions = new Set<string>(), cwds = new Map<string, number>();
  let latest: SkillActivation | null = null;
  for (const r of records) {
    kindSplit[r.kind] = (kindSplit[r.kind] || 0) + 1;
    if (finite(r.ts)) {
      if (r.ts >= cutoff30) count30++;
      if (lastUsedTs == null || r.ts > lastUsedTs) lastUsedTs = r.ts;
      // Only finite-timestamp records can become latest.
      if (!latest || r.ts > latest.ts!) latest = r;
    }
    if (r.sessionId) sessions.add(r.sessionId);
    if (r.cwd) cwds.set(r.cwd, (cwds.get(r.cwd) || 0) + 1);
  }
  const topCwd = [...cwds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return {
    count30d: count30,
    lastUsedTs,
    kindSplit,
    sessionCount: sessions.size,
    cwdCount: cwds.size,
    topCwd,
    total: records.length,
    latest: latest ? { sessionId: latest.sessionId, entryId: latest.entryId, ts: latest.ts, model: latest.model, cwd: latest.cwd } : null,
  };
}

export function createSkillFeatureHandlers(ports: FeaturePorts): Pick<FeatureHandlers, 'skills' | 'skillActivations' | 'skillCoverage'> {
  const skills: FeatureHandler = async (_req, res) => {
    try {
      const cwds = knownWorkspaceCwds(ports.buildSessionCatalog);
      const inventory = await skillsLib.getSkillsInventory({ cwds });
      sessionIndex.setSkillRoots(inventory.skills.map(s => s.filePath));
      const candidates = ports.enumerateSessionCandidates();
      const scan = sessionIndex.scanSessions(candidates);
      const now = Date.now();
      const skills = inventory.skills.map(s => {
        const records = sessionIndex.getSkillActivations({ skill: s.filePath });
        const roll = usageRollup(records, now);
        return { ...s, usage: { ...roll, weeks12: weeklyBuckets(records, 12, now) } };
      });
      const quietCutoff = now - 60 * DAY_MS;
      const summary = {
        discovered: inventory.discovered,
        advertised: inventory.advertised,
        catalogTokensEst: inventory.catalogTokensEst,
        preambleTokensEst: inventory.preambleTokensEst,
        activations30d: skills.reduce((a, s) => a + s.usage.count30d, 0),
        quiet60d: skills.filter(s => s.usage.lastUsedTs == null || s.usage.lastUsedTs < quietCutoff).length,
        diagnostics: inventory.diagnostics.length,
      };
      res.json({
        scope: inventory.scope,
        summary,
        skills,
        diagnostics: inventory.diagnostics,
        refine: resolveRefineConfig(inventory, ports),
        indexing: scan.indexing,
        precision: 'estimate',
      });
    } catch (e) {
      console.error('GET /api/skills failed:', e);
      res.status(500).json({ error: e && typeof e === 'object' && 'message' in e ? e.message : undefined });
    }
  };

  // The primitive: raw activation records as an NDJSON stream. No pagination —
  // a pipe for user scripts. Filters: skill, since (ms epoch or 7d/12h/2w),
  // cwd, kind.
  const skillActivations: FeatureHandler = (req, res) => {
    // Ensure the corpus is indexed (mines skills as a side effect).
    sessionIndex.scanSessions(ports.enumerateSessionCandidates());
    const filter: Parameters<typeof sessionIndex.getSkillActivations>[0] = {};
    if (req.query.skill) filter.skill = String(req.query.skill);
    if (req.query.cwd) filter.cwd = String(req.query.cwd);
    if (req.query.kind) filter.kind = String(req.query.kind);
    const since = req.query.since != null ? String(req.query.since) : '';
    if (since) {
      const rel = since.match(/^(\d+)(h|d|w)$/);
      if (rel) {
        const n = Number(rel[1]);
        const mult = rel[2] === 'h' ? 3600000 : rel[2] === 'd' ? DAY_MS : WEEK_MS;
        filter.sinceMs = Date.now() - n * mult;
      } else {
        const t = /^\d+$/.test(since) ? Number(since) : Date.parse(since);
        if (Number.isFinite(t)) filter.sinceMs = t;
      }
    }
    const records = sessionIndex.getSkillActivations(filter)
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    res.type('application/x-ndjson');
    res.send(records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
  };

  // Current-version coverage rollup for one skill: sections of SKILL.md with a
  // read fraction over the ranged reads since the file's mtime, plus targeted
  // touch counts and a headline unread-tokens estimate.
  const skillCoverage: FeatureHandler = (req, res) => {
    const skill = String(req.query.skill || '');
    if (!skill || path.basename(skill) !== 'SKILL.md') {
      return res.status(400).json({ error: 'skill must be an absolute SKILL.md path' });
    }
    let content: string, stat: fs.Stats;
    try { stat = fs.statSync(skill); content = fs.readFileSync(skill, 'utf-8'); }
    catch { return res.status(404).json({ error: 'skill file not found' }); }

    sessionIndex.scanSessions(ports.enumerateSessionCandidates());
    const now = Date.now();
    const all = sessionIndex.getSkillActivations({ skill });
    const coverage = skillsLib.projectSkillCoverage(content, stat.mtimeMs, all);

    const roll = usageRollup(all, now);
    // Resolve latest activation's session name for the deep-link label.
    let latest: (NonNullable<typeof roll.latest> & { name?: string | null }) | null = roll.latest;
    if (latest && latest.sessionId) {
      try {
        const source = ports.findSessionSource(latest.sessionId);
        if (source) latest = { ...latest, name: sessionIndex.getSessionInfo(source).name || null };
      } catch {}
    }

    res.json({
      skill,
      mtimeMs: stat.mtimeMs,
      ...coverage,
      weeks26: weeklyBuckets(all, 26, now),
      kindSplit: roll.kindSplit,
      sessionCount: roll.sessionCount,
      cwdCount: roll.cwdCount,
      topCwd: roll.topCwd,
      latest,
      precision: 'estimate',
    });
  };

  return { skills, skillActivations, skillCoverage };
}
