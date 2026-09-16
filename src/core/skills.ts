/**
 * Skill inventory for the Skills view. Discovery goes through **pi's own
 * loader** (`loadSkills`, exported from the SDK) — never a reimplementation of
 * pi's discovery/collision rules. We scan each known workspace root (global +
 * every project cwd from the session lists), dedup by SKILL.md path, and derive
 * only observational metadata: byte sizes, a chars/4 token estimate (all badged
 * `estimate` — there is no exact tokenization in Phase 1), and the exact catalog
 * fragment pi would advertise, computed with pi's own `formatSkillsForPrompt`.
 *
 * Skill identity everywhere is the absolute SKILL.md path (stable, matches
 * pi's `<skill location="…">`). `disable-model-invocation` skills are
 * discovered but excluded from the advertised catalog (manual-only), adding
 * zero advertised cost — pi's formatSkillsForPrompt already filters them.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LoadSkillsResult, ResourceDiagnostic, Skill } from '@earendil-works/pi-coding-agent' with { 'resolution-mode': 'import' };
import * as piSDK from './pi-sdk';

type SkillDiagnostic = Pick<ResourceDiagnostic, 'type' | 'message' | 'path'>;
interface BundleFile { file: string; bytes: number }

export interface SkillsInventoryOptions {
  cwds?: readonly string[];
  scope?: string;
}

export interface InventorySkill {
  skill: string;
  name: string;
  description: string;
  source: string;
  advertised: boolean;
  filePath: string;
  baseDir: string;
  bodyBytes: number;
  bodyTokensEst: number;
  catalogFragment: string | null;
  catalogTokensEst: number;
  mtimeMs: number;
  files: BundleFile[];
  diagnostics: SkillDiagnostic[];
  precision: 'estimate';
}

export interface SkillsInventory {
  scope: string;
  discovered: number;
  advertised: number;
  catalogTokensEst: number;
  preambleTokensEst: number;
  diagnostics: SkillDiagnostic[];
  skills: InventorySkill[];
  precision: 'estimate';
}

const est = (chars: number) => Math.ceil((chars || 0) / 4);

// Cap the bundled-file walk so a skill dir with a huge assets tree can't stall
// a request; the coverage endpoint reads authoritative per-file data anyway.
const MAX_BUNDLE_FILES = 200;
const MAX_BUNDLE_DEPTH = 4;

function walkBundle(dir: string, base = dir, depth = 0, out: BundleFile[] = []): BundleFile[] {
  if (out.length >= MAX_BUNDLE_FILES || depth > MAX_BUNDLE_DEPTH) return out;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (out.length >= MAX_BUNDLE_FILES) break;
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    let stat; try { stat = fs.statSync(full); } catch { continue; }
    if (stat.isDirectory()) walkBundle(full, base, depth + 1, out);
    else if (stat.isFile()) out.push({ file: path.relative(base, full), bytes: stat.size });
  }
  return out;
}

function sourceKind(skill: Skill): string {
  const scope = skill.sourceInfo?.scope;
  if (scope === 'user') return 'global';
  if (scope === 'project') return 'project';
  return scope || skill.sourceInfo?.source || 'path';
}

// Exact per-skill catalog fragment, matching pi's formatSkillsForPrompt lines.
function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
export function catalogFragment(skill: Pick<Skill, 'name' | 'description' | 'filePath'>): string {
  return [
    '  <skill>',
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <description>${escapeXml(skill.description)}</description>`,
    `    <location>${escapeXml(skill.filePath)}</location>`,
    '  </skill>',
  ].join('\n');
}

let _cache: { key: string; at: number; value: SkillsInventory } | null = null;
const CACHE_TTL_MS = 4000;

/** Scan project roots plus global user skills, optionally restricted to one cwd. */
export async function getSkillsInventory(opts: SkillsInventoryOptions = {}): Promise<SkillsInventory> {
  const home = os.homedir();
  const cwdList = opts.scope ? [opts.scope] : [...new Set([...(opts.cwds || []), home])];
  const key = cwdList.slice().sort().join('\n');
  if (_cache && _cache.key === key && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.value;

  const sdk = await piSDK.getSDK();
  const byPath = new Map<string, Skill>();
  const diagnostics: SkillDiagnostic[] = [];
  const diagSeen = new Set<string>();
  for (const cwd of cwdList) {
    let result: LoadSkillsResult;
    // The SDK runtime defaults an omitted agentDir to getAgentDir(); its public
    // options type requires the value, so supply that same SDK-owned default.
    try { result = sdk.loadSkills({ cwd, agentDir: sdk.getAgentDir(), includeDefaults: true, skillPaths: [] }); }
    catch { continue; }
    for (const d of result.diagnostics || []) {
      const k = `${d.type}:${d.path}:${d.message}`;
      if (!diagSeen.has(k)) { diagSeen.add(k); diagnostics.push({ type: d.type, message: d.message, path: d.path }); }
    }
    for (const s of result.skills || []) {
      if (!byPath.has(s.filePath)) byPath.set(s.filePath, s);
    }
  }

  const visible = [...byPath.values()].filter((s) => !s.disableModelInvocation);
  const fullCatalog = visible.length ? sdk.formatSkillsForPrompt(visible) : '';
  // Shared overhead = the advertised catalog with every per-skill fragment
  // removed (preamble instructions + <available_skills> wrapper). Reported
  // once at the summary level.
  let overheadChars = fullCatalog.length;
  for (const s of visible) overheadChars -= catalogFragment(s).length + 1;
  if (overheadChars < 0) overheadChars = 0;

  const skills = [...byPath.values()].map((s): InventorySkill => {
    let bodyBytes = 0, bodyChars = 0, mtimeMs = 0;
    try {
      const stat = fs.statSync(s.filePath);
      bodyBytes = stat.size; mtimeMs = stat.mtimeMs;
      bodyChars = fs.readFileSync(s.filePath, 'utf-8').length;
    } catch {}
    const frag = catalogFragment(s);
    const skillDiags = diagnostics.filter((d) => d.path === s.filePath);
    return {
      skill: s.filePath,           // identity
      name: s.name,
      description: s.description,
      source: sourceKind(s),
      advertised: !s.disableModelInvocation,
      filePath: s.filePath,
      baseDir: s.baseDir,
      bodyBytes,
      bodyTokensEst: est(bodyChars),
      catalogFragment: s.disableModelInvocation ? null : frag,
      catalogTokensEst: s.disableModelInvocation ? 0 : est(frag.length),
      mtimeMs,
      files: walkBundle(s.baseDir),
      diagnostics: skillDiags,
      precision: 'estimate',
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const value: SkillsInventory = {
    scope: opts.scope || 'all',
    discovered: skills.length,
    advertised: visible.length,
    catalogTokensEst: est(fullCatalog.length),
    preambleTokensEst: est(overheadChars),
    diagnostics,
    skills,
    precision: 'estimate',
  };
  _cache = { key, at: Date.now(), value };
  return value;
}

/** Absolute SKILL.md paths for the mining context (session-index.setSkillRoots). */
export async function getSkillFilePaths(opts: SkillsInventoryOptions = {}): Promise<string[]> {
  const inv = await getSkillsInventory(opts);
  return inv.skills.map((s) => s.filePath);
}

export function _resetCacheForTests(): void { _cache = null; }
