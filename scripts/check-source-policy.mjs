#!/usr/bin/env node
// Generated tool from scripts/check-source-policy.mts; edit that source and run npm run build:tools.
// TypeScript 7's pinned native parser owns syntax, including JSDoc and templates.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
    const visit = (node) => {
        const key = `${node.kind}:${node.pos}:${node.end}`;
        if (seen.has(key))
            return;
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
        if (end !== undefined) {
            scanner.resetTokenState(end);
            continue;
        }
        if (token !== SyntaxKind.SingleLineCommentTrivia && token !== SyntaxKind.MultiLineCommentTrivia)
            continue;
        const comment = scanner.getTokenText();
        for (const match of comment.matchAll(/@ts-(ignore|nocheck|expect-error)\b/g)) {
            const directive = match[1];
            if (directive !== 'expect-error')
                report(scanner.getTokenStart() + match.index, `@ts-${directive} is forbidden`);
            else if (!fixture)
                report(scanner.getTokenStart() + match.index, '@ts-expect-error is confined to named negative fixtures');
            else if (!comment.slice(match.index + match[0].length).replace(/\*\/$/, '').trim()) {
                report(scanner.getTokenStart() + match.index, '@ts-expect-error requires its diagnostic purpose');
            }
        }
    }
    return failures;
}
function objectValue(value, field) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Source policy ${field} must be an object`);
    }
    return value;
}
function stringValue(value, field) {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`Source policy ${field} must be a non-empty string`);
    return value;
}
function stringList(value, field) {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        throw new Error(`Source policy ${field} must be an array of paths`);
    }
    return value;
}
function objectList(value, field) {
    if (!Array.isArray(value))
        throw new Error(`Source policy ${field} must be an array`);
    return value.map((item, index) => objectValue(item, `${field}[${index}]`));
}
function configFiles(root, config) {
    const parsed = objectValue(JSON.parse(fs.readFileSync(path.join(root, config), 'utf8')), config);
    return stringList(parsed.files, `${config}.files`);
}
export function repositoryPaths(root) {
    const cached = spawnSync('git', ['ls-files', '--cached', '-z'], {
        cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    if (cached.error)
        throw cached.error;
    if (cached.status !== 0)
        throw new Error(`git ls-files --cached failed: ${cached.stderr.trim()}`);
    const others = spawnSync('git', [
        'ls-files', '--others', '--exclude-standard', '-z', '--', '.',
        ':(exclude).amp', ':(exclude).amp/**',
    ], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (others.error)
        throw others.error;
    if (others.status !== 0)
        throw new Error(`git ls-files --others failed: ${others.stderr.trim()}`);
    const tracked = cached.stdout.split('\0').filter(Boolean);
    const untracked = others.stdout.split('\0')
        .filter(file => file && file !== '.amp' && !file.startsWith('.amp/'));
    const trackedPaths = new Set(tracked);
    const paths = new Set([...trackedPaths, ...untracked]);
    const staged = spawnSync('git', ['ls-files', '--stage', '-z'], {
        cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    });
    if (staged.error)
        throw staged.error;
    if (staged.status !== 0)
        throw new Error(`git ls-files --stage failed: ${staged.stderr.trim()}`);
    const modes = new Map();
    for (const row of staged.stdout.split('\0')) {
        if (!row)
            continue;
        const match = /^(\d+) [0-9a-f]+ \d+\t(.+)$/.exec(row);
        if (!match)
            throw new Error(`Unexpected git index row: ${row}`);
        modes.set(match[2], match[1]);
    }
    for (const file of untracked) {
        if (fs.existsSync(path.join(root, file))) {
            modes.set(file, fs.statSync(path.join(root, file)).mode & 0o111 ? '100755' : '100644');
        }
    }
    return { paths, tracked: trackedPaths, modes };
}
export function isExecutableFamilyPath(file) {
    return /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/.test(file);
}
function isTypeScriptImplementationPath(file) {
    return /\.(?:[cm]?ts|tsx)$/.test(file) && !/\.d\.[cm]?ts$/.test(file);
}
export function shellInventoryPaths(paths, modes) {
    return [...paths].filter(file => file.endsWith('.sh')
        || (modes.get(file) === '100755' && !isExecutableFamilyPath(file))).sort();
}
export function validateShellInventory(root, repository, declared) {
    const discovered = new Set(shellInventoryPaths(repository.paths, repository.modes));
    const paths = [...new Set([...discovered, ...declared])].sort();
    const failures = [];
    for (const file of discovered) {
        if (!declared.has(file))
            failures.push(`${file}: unclassified tracked shell path`);
    }
    for (const file of declared) {
        if (!repository.tracked.has(file))
            failures.push(`${file}: declared shell path is not tracked`);
        const indexMode = repository.modes.get(file);
        if (repository.tracked.has(file) && indexMode !== '100755') {
            failures.push(`${file}: tracked shell index mode must be 100755 (got ${indexMode || 'missing'})`);
        }
        const absolute = path.join(root, file);
        const metadata = fs.lstatSync(absolute, { throwIfNoEntry: false });
        if (!metadata) {
            failures.push(`${file}: declared shell path is absent from worktree`);
            continue;
        }
        if (!metadata.isFile()) {
            failures.push(`${file}: declared shell path is not a regular file`);
            continue;
        }
        const worktreeMode = metadata.mode & 0o777;
        if (worktreeMode !== 0o755) {
            failures.push(`${file}: shell worktree mode must be 0755 (got ${worktreeMode.toString(8).padStart(4, '0')})`);
        }
    }
    return { paths, failures };
}
function outputSuffixes(source, declaration) {
    const runtime = source.endsWith('.mts') ? '.mjs' : source.endsWith('.cts') ? '.cjs' : '.js';
    if (!declaration)
        return [runtime];
    const declarationSuffix = source.endsWith('.mts') ? '.d.mts' : source.endsWith('.cts') ? '.d.cts' : '.d.ts';
    return [runtime, declarationSuffix];
}
function withoutSourceSuffix(source) {
    return source.replace(/\.(?:ts|mts|cts)$/, '');
}
function expectedBanner(output) {
    if (output.group === 'core')
        return `// Generated from ${output.source};`;
    if (output.group === 'tools')
        return `// Generated tool from ${output.source};`;
    if (output.group === 'tests')
        return `// Generated test/tool from ${output.source};`;
    if (output.group === 'edges')
        return `// Generated edge from ${output.source};`;
    if (output.group === 'browser')
        return '// Generated from src/browser/;';
    return undefined;
}
function generatedOutputs(root, inventory) {
    const outputs = new Map();
    const add = (output) => {
        if (outputs.has(output.path))
            throw new Error(`Duplicate generated-output owner: ${output.path}`);
        outputs.set(output.path, output);
    };
    for (const groupValue of objectList(inventory.generatedGroups, 'inventory.generatedGroups')) {
        const name = stringValue(groupValue.name, 'generated group name');
        const strategy = stringValue(groupValue.strategy, `${name}.strategy`);
        const builder = stringValue(groupValue.builder, `${name}.builder`);
        const checkCommand = stringValue(groupValue.checkCommand, `${name}.checkCommand`);
        const consumer = stringValue(groupValue.consumer, `${name}.consumer`);
        if (strategy === 'flat') {
            const sourceRoot = stringValue(groupValue.sourceRoot, `${name}.sourceRoot`);
            const outputRoot = stringValue(groupValue.outputRoot, `${name}.outputRoot`);
            const sources = fs.readdirSync(path.join(root, sourceRoot), { withFileTypes: true })
                .filter(entry => entry.isFile() && /\.(?:ts|mts|cts)$/.test(entry.name) && !/\.d\.(?:ts|mts|cts)$/.test(entry.name))
                .map(entry => `${sourceRoot}/${entry.name}`).sort();
            for (const source of sources) {
                for (const suffix of outputSuffixes(source, true)) {
                    add({ path: `${outputRoot}/${path.basename(withoutSourceSuffix(source))}${suffix}`, source, group: name,
                        builder, checkCommand, consumer, declaration: suffix.startsWith('.d.'), external: false });
                }
            }
        }
        else if (strategy === 'siblings') {
            const programs = stringList(groupValue.programs, `${name}.programs`);
            const declarationPrograms = new Set(stringList(groupValue.declarationPrograms, `${name}.declarationPrograms`));
            for (const program of programs) {
                for (const source of configFiles(root, program)) {
                    if (/\.d\.(?:ts|mts|cts)$/.test(source))
                        continue;
                    for (const suffix of outputSuffixes(source, declarationPrograms.has(program))) {
                        add({ path: withoutSourceSuffix(source) + suffix, source, group: name, builder, checkCommand, consumer,
                            declaration: suffix.startsWith('.d.'), external: false });
                    }
                }
            }
        }
        else if (strategy === 'bundles' || strategy === 'external') {
            for (const entry of objectList(groupValue.entries, `${name}.entries`)) {
                add({ path: stringValue(entry.output, `${name}.entry.output`), source: stringValue(entry.source, `${name}.entry.source`),
                    group: name, builder, checkCommand, consumer, declaration: false, external: strategy === 'external' });
            }
        }
        else {
            throw new Error(`Unsupported generated-output strategy: ${strategy}`);
        }
    }
    return [...outputs.values()].sort((left, right) => left.path.localeCompare(right.path));
}
export function validateLinguist(root, file, repository, generated, failures) {
    const target = path.join(root, file);
    if (!fs.existsSync(target)) {
        failures.push(`${file}: missing generated-file Linguist classifications`);
        return;
    }
    const input = `${[...repository].sort().join('\0')}\0`;
    const result = spawnSync('git', ['check-attr', '-z', '--stdin', 'linguist-generated'], {
        cwd: root, encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error)
        throw result.error;
    if (result.status !== 0)
        throw new Error(`git check-attr failed: ${result.stderr.trim()}`);
    const fields = result.stdout.split('\0');
    if (fields.at(-1) === '')
        fields.pop();
    if (fields.length !== repository.size * 3) {
        throw new Error(`git check-attr returned ${fields.length} fields for ${repository.size} paths`);
    }
    const seen = new Set();
    for (let index = 0; index < fields.length; index += 3) {
        const [checkedPath, attribute, value] = fields.slice(index, index + 3);
        if (attribute !== 'linguist-generated' || !repository.has(checkedPath) || seen.has(checkedPath)) {
            throw new Error(`Unexpected git check-attr row: ${checkedPath} ${attribute} ${value}`);
        }
        seen.add(checkedPath);
        const normalized = value.toLowerCase();
        const effectiveGenerated = value === 'set' || normalized === 'true';
        const effectiveNotGenerated = value === 'unset' || value === 'unspecified' || normalized === 'false';
        if (!effectiveGenerated && !effectiveNotGenerated) {
            failures.push(`${checkedPath}: unsupported effective linguist-generated value ${JSON.stringify(value)}`);
        }
        else if (generated.has(checkedPath) && !effectiveGenerated) {
            failures.push(`${checkedPath}: generated output has effective linguist-generated=${value}`);
        }
        else if (!generated.has(checkedPath) && effectiveGenerated) {
            failures.push(`${checkedPath}: non-generated path has effective linguist-generated=${value}`);
        }
    }
    if (seen.size !== repository.size)
        throw new Error('git check-attr omitted repository paths');
}
export function classifyExecutableInventory(executablePaths, generatedPaths, compilerSources, supportDeclarations, exceptions) {
    const failures = [];
    const present = new Set(executablePaths);
    const compilerBodies = new Set();
    for (const file of executablePaths) {
        const declaration = /\.d\.(?:ts|mts|cts)$/.test(file);
        const generated = generatedPaths.has(file);
        const compilerOwned = compilerSources.has(file) && !declaration;
        const support = supportDeclarations.has(file);
        const exception = exceptions.has(file);
        const classifications = Number(generated) + Number(compilerOwned) + Number(support) + Number(exception);
        if (classifications === 0)
            failures.push(`${file}: unclassified tracked executable path`);
        if (classifications > 1)
            failures.push(`${file}: multiple source-inventory classifications`);
        if (compilerOwned)
            compilerBodies.add(file);
        if (support && !compilerSources.has(file)) {
            failures.push(`${file}: compiler-support declaration is not in an actual program`);
        }
        if (exception && (generated || compilerSources.has(file)))
            failures.push(`${file}: stale named exception`);
    }
    for (const file of supportDeclarations) {
        if (!present.has(file))
            failures.push(`${file}: stale compiler-support declaration entry`);
    }
    for (const file of exceptions)
        if (!present.has(file))
            failures.push(`${file}: stale named exception`);
    return { failures, compilerBodies };
}
export function checkPolicy(root) {
    const policy = objectValue(JSON.parse(fs.readFileSync(path.join(root, 'source-policy.json'), 'utf8')), 'root');
    for (const field of ['authoredRoots', 'programs', 'negativeFixtures', 'files', 'roots', 'inventory']) {
        if (!(field in policy))
            throw new Error(`Source policy must name ${field}`);
    }
    const projectFiles = stringList(policy.programs, 'programs');
    const fixtures = new Set(stringList(policy.negativeFixtures, 'negativeFixtures'));
    const governed = new Set(stringList(policy.files, 'files'));
    const roots = stringList(policy.roots, 'roots');
    const authoredRoots = stringList(policy.authoredRoots, 'authoredRoots');
    const inventoryPolicy = objectValue(policy.inventory, 'inventory');
    const repository = repositoryPaths(root);
    const executablePaths = [...repository.paths].filter(isExecutableFamilyPath).sort();
    const failures = [];
    const api = new API();
    let compilerSources = new Set();
    const programs = [];
    try {
        const snapshot = api.updateSnapshot({ openProjects: projectFiles.map(file => path.join(root, file)) });
        for (const project of snapshot.getProjects()) {
            programs.push(project.program);
            for (const absolute of project.program.getSourceFileNames()) {
                const relative = path.relative(root, absolute).split(path.sep).join('/');
                if (relative && !relative.startsWith('../') && !path.isAbsolute(relative))
                    compilerSources.add(relative);
            }
        }
        const expected = generatedOutputs(root, inventoryPolicy);
        const expectedByPath = new Map(expected.map(output => [output.path, output]));
        let compilerBodies = new Set();
        const generatedRuntime = new Set();
        const generatedDeclarations = new Set();
        const supportDeclarations = new Map(objectList(inventoryPolicy.compilerSupportDeclarations, 'inventory.compilerSupportDeclarations')
            .map(entry => [stringValue(entry.path, 'compiler support declaration path'), entry]));
        const exceptions = new Map(objectList(inventoryPolicy.exceptions, 'inventory.exceptions').map(entry => {
            const exceptionPath = stringValue(entry.path, 'exception path');
            stringValue(entry.kind, `${exceptionPath}.kind`);
            stringValue(entry.consumer, `${exceptionPath}.consumer`);
            stringValue(entry.rationale, `${exceptionPath}.rationale`);
            return [exceptionPath, entry];
        }));
        for (const output of expected) {
            if (!repository.paths.has(output.path)) {
                failures.push(`${output.path}: missing generated output owned by ${output.source}`);
                continue;
            }
            if (!output.external && (!repository.paths.has(output.source) || !compilerSources.has(output.source))) {
                failures.push(`${output.path}: generated source is not compiler-owned: ${output.source}`);
            }
            const absolute = path.join(root, output.path);
            if (!fs.existsSync(absolute)) {
                failures.push(`${output.path}: generated output is absent from the worktree`);
                continue;
            }
            const banner = expectedBanner(output);
            if (banner) {
                const content = fs.readFileSync(absolute, 'utf8').replace(/^#![^\n]*\n/, '');
                if (!content.startsWith(banner))
                    failures.push(`${output.path}: generated ownership banner does not name ${output.source}`);
            }
            (output.declaration ? generatedDeclarations : generatedRuntime).add(output.path);
        }
        const knownBanners = ['// Generated from src/core/', '// Generated tool from ', '// Generated test/tool from ',
            '// Generated edge from ', '// Generated from src/browser/;'];
        for (const file of executablePaths) {
            const absolute = path.join(root, file);
            if (fs.existsSync(absolute) && !expectedByPath.has(file)) {
                const content = fs.readFileSync(absolute, 'utf8').replace(/^#![^\n]*\n/, '');
                if (knownBanners.some(banner => content.startsWith(banner)))
                    failures.push(`${file}: orphan generated output`);
            }
        }
        const classified = classifyExecutableInventory(executablePaths, new Set(expectedByPath.keys()), compilerSources, new Set(supportDeclarations.keys()), new Set(exceptions.keys()));
        failures.push(...classified.failures);
        compilerBodies = classified.compilerBodies;
        const shellEntries = new Map(objectList(inventoryPolicy.shell, 'inventory.shell').map(entry => {
            const shellPath = stringValue(entry.path, 'shell path');
            stringValue(entry.consumer, `${shellPath}.consumer`);
            stringValue(entry.evidence, `${shellPath}.evidence`);
            return [shellPath, entry];
        }));
        const shell = validateShellInventory(root, repository, new Set(shellEntries.keys()));
        const shellPaths = shell.paths;
        failures.push(...shell.failures);
        validateLinguist(root, stringValue(inventoryPolicy.linguistAttributes, 'inventory.linguistAttributes'), repository.paths, new Set(expected.map(output => output.path)), failures);
        for (const dir of roots) {
            for (const entry of fs.readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })) {
                if (isExecutableFamilyPath(entry))
                    governed.add(`${dir}/${entry}`);
            }
        }
        for (const dir of authoredRoots) {
            for (const entry of fs.readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })) {
                if (isTypeScriptImplementationPath(entry))
                    governed.add(`${dir}/${entry}`);
            }
        }
        for (const file of compilerBodies)
            governed.add(file);
        for (const file of supportDeclarations.keys())
            governed.add(file);
        for (const fixture of fixtures)
            governed.add(fixture);
        for (const file of [...governed].sort()) {
            const absolute = path.join(root, file);
            const program = programs.find(candidate => candidate.getSourceFileNames().includes(absolute));
            const source = program?.getSourceFile(absolute);
            if (!program || !source || !fs.existsSync(absolute)) {
                failures.push(`${file}: missing compiler-owned source`);
                continue;
            }
            const syntax = program.getSyntacticDiagnostics(absolute);
            if (syntax.length)
                failures.push(`${file}: ${syntax.length} parser diagnostic(s); run npm run typecheck`);
            for (const failure of inspectSource(source, fixtures.has(file)))
                failures.push(`${file}:${failure}`);
            if (fixtures.has(file) && !source.text.includes('@ts-expect-error'))
                failures.push(`${file}: stale negative-fixture exception`);
        }
        return { failures, count: governed.size, inventory: {
                executablePaths: executablePaths.length,
                shellPaths: shellPaths.length,
                compilerBodies: compilerBodies.size,
                generatedRuntime: generatedRuntime.size,
                generatedDeclarations: generatedDeclarations.size,
                supportDeclarations: supportDeclarations.size,
                exceptions: exceptions.size,
            } };
    }
    finally {
        compilerSources = new Set();
        api.close();
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { failures, count, inventory } = checkPolicy(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
    if (failures.length) {
        console.error(failures.join('\n'));
        process.exitCode = 1;
    }
    else
        console.log(`Authored source policy passed (${count} compiler-owned sources; ${inventory.executablePaths} executable paths and ${inventory.shellPaths} shell paths fully classified).`);
}
