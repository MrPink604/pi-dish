// Shared plumbing for the checked-in build outputs: map a TypeScript source to
// its sibling runtime/declaration files, compile one program into a temporary
// directory, then either verify or rewrite the tracked output. Compiling first
// means a type error can never leave a partially updated tree behind.
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { spawnSync } from 'node:child_process';

export const root = path.resolve(__dirname, '..');

export function checkRequested(script: string): boolean {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check')) throw new Error(`Usage: node scripts/${script} [--check]`);
  return args.includes('--check');
}

export function programFiles(config: string): string[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(root, config), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('files' in parsed)
      || !Array.isArray(parsed.files) || !parsed.files.every((file: unknown) => typeof file === 'string')) {
    throw new Error(`${config} must list its source files`);
  }
  return parsed.files as string[];
}

export interface OutputEntry {
  source: string;
  executable: boolean;
}

export type OutputMap = Map<string, OutputEntry>;

export interface OutputOptions {
  /** Names the mapping in duplicate/mismatch messages, e.g. `Tool`. */
  kind: string;
  declarations(source: string): boolean;
  executable(source: string): boolean;
}

export function siblingOutputs(sources: readonly string[], options: OutputOptions): OutputMap {
  const outputs: OutputMap = new Map();
  for (const source of sources) {
    const esm = source.endsWith('.mts');
    const runtime = esm ? '.mjs' : '.js';
    const declaration = esm ? '.d.mts' : '.d.ts';
    const suffixes = options.declarations(source) ? [runtime, declaration] : [runtime];
    for (const suffix of suffixes) {
      const file = source.replace(/\.(?:ts|mts)$/, '') + suffix;
      if (outputs.has(file)) throw new Error(`Duplicate ${options.kind} output: ${file}`);
      outputs.set(file, { source, executable: options.executable(source) && suffix === runtime });
    }
  }
  return outputs;
}

/** Compile `project`, hand the emitted tree to `step`, then delete it. */
export function buildProgram(
  project: string,
  prefix: string,
  step: (files: readonly string[], read: (file: string) => string) => void,
): boolean {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    const compiler = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
    const result = spawnSync(process.execPath, [compiler, '-p', project, '--outDir', out], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status || 1;
      return false;
    }
    const files = fs.readdirSync(out, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => path.relative(out, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
    step(files, file => fs.readFileSync(path.join(out, file), 'utf8'));
    return true;
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

export function verifyMapping(kind: string, emitted: readonly string[], outputs: ReadonlyMap<string, unknown>, extra: readonly string[] = []): void {
  const unexpected = emitted.filter(file => !outputs.has(file) && !extra.includes(file));
  const missing = [...outputs.keys()].filter(file => !emitted.includes(file));
  if (unexpected.length || missing.length) {
    throw new Error(`${kind} output mapping mismatch; unexpected: ${unexpected.join(', ')}; missing: ${missing.join(', ')}`);
  }
}

/** Tracked files that carry this builder's banner but are no longer owned by it. */
export function orphanedOutputs(
  directories: readonly string[],
  banner: string,
  outputs: ReadonlyMap<string, unknown>,
  recursive: boolean,
): string[] {
  const orphaned: string[] = [];
  for (const directory of directories) {
    const base = path.join(root, directory);
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { recursive, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:js|mjs|d\.ts|d\.mts)$/.test(entry.name)) continue;
      const file = path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
      if (outputs.has(file)) continue;
      const content = fs.readFileSync(path.join(root, file), 'utf8').replace(/^#![^\n]*\n/, '');
      if (content.startsWith(banner)) orphaned.push(file);
    }
  }
  return orphaned;
}

export interface GeneratedOutput {
  file: string;
  target: string;
  content: string;
  mode: number;
}

export interface GeneratedOptions {
  /** Ownership banner, e.g. `// Generated tool from `. */
  banner: string;
  /** npm script that regenerates the output, e.g. `build:tools`. */
  command: string;
  read(file: string, source: string): string;
}

export function generatedOutputs(outputs: OutputMap, options: GeneratedOptions): GeneratedOutput[] {
  const prepared: GeneratedOutput[] = [];
  for (const [file, { source, executable }] of outputs) {
    const raw = options.read(file, source);
    const shebang = raw.match(/^#![^\n]*\n/)?.[0] || '';
    if (executable && shebang !== '#!/usr/bin/env node\n') throw new Error(`CLI shebang missing or invalid: ${source}`);
    prepared.push({
      file,
      target: path.join(root, file),
      content: shebang + `${options.banner}${source}; edit that source and run npm run ${options.command}.\n` + raw.slice(shebang.length),
      mode: executable ? 0o755 : 0o644,
    });
  }
  return prepared;
}

export interface WriteOptions {
  check: boolean;
  kind: string;
  command: string;
  checkOk: string;
  writeOk: string;
}

export function writeOutputs(prepared: readonly GeneratedOutput[], options: WriteOptions): void {
  if (!options.check) {
    for (const { target, content, mode } of prepared) {
      fs.writeFileSync(target, content);
      fs.chmodSync(target, mode);
    }
    console.log(options.writeOk);
    return;
  }
  const stale = prepared.filter(({ target, content, mode }) => !fs.existsSync(target)
    || fs.readFileSync(target, 'utf8') !== content
    || (fs.statSync(target).mode & 0o777) !== mode);
  if (!stale.length) {
    console.log(options.checkOk);
    return;
  }
  console.error(`${options.kind} output is stale; run npm run ${options.command}:\n${stale.map(({ file }) => file).join('\n')}`);
  process.exitCode = 1;
}
