// Absolute or ~-rooted tokens inside command strings. Resolution, authorization,
// ranking and skill classification belong to callers, not this Node-only matcher.
const COMMAND_PATH_RE = /(?:^|[\s'"`=(<>])((?:\/|~\/)[\w.@%+-]+(?:\/[\w.@%+-]+)*)/g;

export function matchCommandPaths(command: string): RegExpStringIterator<RegExpExecArray> {
  return command.matchAll(COMMAND_PATH_RE);
}
