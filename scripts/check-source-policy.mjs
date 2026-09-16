#!/usr/bin/env node
// TypeScript 7's pinned native parser owns syntax, including JSDoc and templates.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API } from 'typescript/unstable/sync';
import { SyntaxKind, createScanner } from 'typescript/unstable/ast';

export function inspectSource(source, fixture = false) {
  const failures = [];
  const literals = new Map();
  const seen = new Set();
  const report = (pos, message) => {
    const { line, character } = source.getLineAndCharacterOfPosition(pos);
    failures.push(`${line + 1}:${character + 1}: ${message}`);
  };
  const visit = node => {
    const key = `${node.kind}:${node.pos}:${node.end}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (node.kind === SyntaxKind.AnyKeyword || node.kind === SyntaxKind.JSDocAllType) {
      report(node.getStart(source), 'explicit any is forbidden (including JSDoc wildcard types)');
    }
    if ([SyntaxKind.StringLiteral, SyntaxKind.RegularExpressionLiteral,
      SyntaxKind.NoSubstitutionTemplateLiteral, SyntaxKind.TemplateHead,
      SyntaxKind.TemplateMiddle, SyntaxKind.TemplateTail].includes(node.kind)) {
      literals.set(node.getStart(source), node.end);
    }
    node.forEachChild(visit);
    node.jsDoc?.forEach(visit);
  };
  visit(source);
  // Skip parser-identified literal spans, not guessed quote/regex delimiters.
  // This still inspects comments inside template substitutions and empty blocks.
  const scanner = createScanner(false, source.languageVariant, source.text);
  for (let token = scanner.scan(); token !== SyntaxKind.EndOfFile; token = scanner.scan()) {
    const end = literals.get(scanner.getTokenStart());
    if (end !== undefined) { scanner.resetTokenState(end); continue; }
    if (token !== SyntaxKind.SingleLineCommentTrivia && token !== SyntaxKind.MultiLineCommentTrivia) continue;
    const comment = scanner.getTokenText();
    for (const match of comment.matchAll(/@ts-(ignore|nocheck|expect-error)\b/g)) {
      const directive = match[1];
      if (directive !== 'expect-error') report(scanner.getTokenStart() + match.index, `@ts-${directive} is forbidden`);
      else if (!fixture) report(scanner.getTokenStart() + match.index, '@ts-expect-error is confined to named negative fixtures');
      else if (!comment.slice(match.index + match[0].length).replace(/\*\/$/, '').trim()) {
        report(scanner.getTokenStart() + match.index, '@ts-expect-error requires its diagnostic purpose');
      }
    }
  }
  return failures;
}

export function checkPolicy(root) {
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'source-policy.json'), 'utf8'));
  const api = new API();
  const failures = [];
  const fixtures = new Set(policy.negativeFixtures);
  const governed = new Set(policy.files);
  for (const dir of policy.roots) {
    for (const entry of fs.readdirSync(path.join(root, dir), { recursive: true })) {
      if (/\.(?:[cm]?[jt]s|tsx|jsx)$/.test(entry)) governed.add(`${dir}/${entry}`);
    }
  }
  for (const fixture of fixtures) governed.add(fixture);
  try {
    const snapshot = api.updateSnapshot({ openProjects: policy.programs.map(file => path.join(root, file)) });
    const programs = snapshot.getProjects().map(project => project.program);
    for (const file of [...governed].sort()) {
      const absolute = path.join(root, file);
      const program = programs.find(candidate => candidate.getSourceFileNames().includes(absolute));
      const source = program?.getSourceFile(absolute);
      if (!source || !fs.existsSync(absolute)) { failures.push(`${file}: missing compiler-owned source`); continue; }
      const syntax = program.getSyntacticDiagnostics(absolute);
      if (syntax.length) failures.push(`${file}: ${syntax.length} parser diagnostic(s); run npm run typecheck`);
      for (const failure of inspectSource(source, fixtures.has(file))) failures.push(`${file}:${failure}`);
      if (fixtures.has(file) && !source.text.includes('@ts-expect-error')) failures.push(`${file}: stale negative-fixture exception`);
    }
  } finally { api.close(); }
  return { failures, count: governed.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { failures, count } = checkPolicy(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log(`Authored source policy passed (${count} compiler-owned sources; no explicit-any exceptions).`);
}
