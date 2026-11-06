import fs = require('fs');
import path = require('path');
import type { RouteHandler } from './http-boundary';
import { dishDir } from './dish-store';
import { isRecord } from './wire-protocol';

const AGENT_DOC_TOPIC_RE = /^[a-z0-9-]{1,64}$/;
const AGENT_DOC_DESCRIPTION_MAX = 160;

function agentDocSummary(markdown: string) {
  const lines = markdown.split('\n');
  let title = '';
  let index = 0;
  for (; index < lines.length; index++) {
    const heading = /^#\s+(.*\S)\s*$/.exec(lines[index]);
    if (heading) { title = heading[1]; index++; break; }
  }
  let description = '';
  for (; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith('#')) continue;
    description = line;
    break;
  }
  if (description.length > AGENT_DOC_DESCRIPTION_MAX) {
    description = description.slice(0, AGENT_DOC_DESCRIPTION_MAX - 1).trimEnd() + '\u2026';
  }
  return { title, description };
}

/**
 * The server ships the agent-facing docs for the API this build serves, so an
 * agent in a mixed-version fleet reads the running host's docs.
 */
export function createAgentDocHandlers(docsDirectory: string) {
  const list: RouteHandler = (_req, res) => {
    let files: string[];
    try {
      files = fs.readdirSync(docsDirectory).filter((file) => file.endsWith('.md')).sort();
    } catch {
      return res.json({ topics: [] });
    }
    const topics = [];
    for (const file of files) {
      const name = file.slice(0, -'.md'.length);
      if (!AGENT_DOC_TOPIC_RE.test(name)) continue;
      try {
        topics.push({ name, ...agentDocSummary(fs.readFileSync(path.join(docsDirectory, file), 'utf-8')) });
      } catch {}
    }
    res.json({ topics });
  };

  const topic: RouteHandler = (req, res) => {
    const name = req.params.topic;
    // The shape gate is also the path-traversal gate.
    if (!AGENT_DOC_TOPIC_RE.test(name)) return res.status(404).json({ error: 'Unknown docs topic' });
    let markdown: string;
    try {
      markdown = fs.readFileSync(path.join(docsDirectory, `${name}.md`), 'utf-8');
    } catch {
      return res.status(404).json({ error: 'Unknown docs topic' });
    }
    res.type('text/markdown; charset=utf-8').send(markdown);
  };

  return { list, topic };
}

/**
 * The two built-in themes (defined in style.css) plus user token files under
 * ~/.pi/dish/themes/*.json. Unreadable or malformed files are skipped: a broken
 * theme file must not take down the picker. Re-read per call so edits show.
 */
export const themesHandler: RouteHandler = (_req, res) => {
  const themes: { id: string; builtin?: boolean; tokens?: Record<string, string> }[] = [
    { id: 'solarized', builtin: true }, { id: 'graphite', builtin: true },
  ];
  try {
    const directory = path.join(dishDir(), 'themes');
    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort()) {
      try {
        const raw: unknown = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf-8'));
        const tokens: Record<string, string> = {};
        for (const [key, value] of Object.entries(isRecord(raw) ? raw : {})) {
          if (/^--[a-z][a-z0-9-]*$/.test(key) && typeof value === 'string' && /^[#a-zA-Z0-9(),.%\s-]+$/.test(value)) {
            tokens[key] = value;
          }
        }
        const id = file.replace(/\.json$/, '');
        if (Object.keys(tokens).length && !themes.some((theme) => theme.id === id)) themes.push({ id, tokens });
      } catch {}
    }
  } catch {}
  res.json({ themes });
};
