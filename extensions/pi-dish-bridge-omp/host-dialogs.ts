import { dialogText, withDismissSignal, type HostDialogRace } from "../pi-dish-bridge/core.js";
import { field, isHostMethod, isObject, type HostMethod } from "../pi-dish-bridge/host.js";

// OMP's interactive mode asks for cfg:// settings changes and report_tool_issue
// consent through ExtensionUiController.showCollabAwareSelector directly,
// never through the extension ui object the bridge wraps (verified 18.18.6).
// The controller prototype is patched once per process; every wrapper wraps
// the stored original, so a reloaded module replaces rather than stacks it.
// The current bridge's racer lives in the symbol registry, which survives
// extension module reloads.
const ORIGINAL_SELECTOR = Symbol.for("pi-dish-bridge.omp-collab-selector");
const RACE_KEY = Symbol.for("pi-dish-bridge.omp-host-dialog-race");
const sharedGlobal = globalThis as unknown as Record<PropertyKey, unknown>;

export function routeOmpHostDialogs(race: HostDialogRace | null): void {
  sharedGlobal[RACE_KEY] = race;
}

export function patchOmpExtensionUiController(controller: unknown): void {
  const proto = field(controller, "prototype");
  if (typeof controller !== "function" || !isObject(proto)) return;
  const stored = proto[ORIGINAL_SELECTOR];
  const original: HostMethod | null = isHostMethod(stored) ? stored
    : isHostMethod(proto.showCollabAwareSelector) ? proto.showCollabAwareSelector : null;
  if (!original) return;
  proto[ORIGINAL_SELECTOR] = original;
  proto.showCollabAwareSelector = function (this: unknown, title: unknown, options: unknown, dialogOptions?: unknown, extra?: unknown) {
    const open = (dismiss: AbortSignal | null) => Reflect.apply(original, this, [
      title, options, dismiss ? withDismissSignal(dialogOptions, dismiss) : dialogOptions, extra,
    ]);
    const race = sharedGlobal[RACE_KEY];
    if (!isHostMethod(race)) return open(null);
    return Reflect.apply(race, undefined, [
      { method: "select", ...dialogText(title), options, timeout: field(dialogOptions, "timeout") },
      (response: unknown) => (field(response, "cancelled") ? undefined : field(response, "value")),
      open,
    ]);
  };
}

// OMP's ask tool (18.18.3+) sends one HTML form through ui.formDialog. Its own
// parser (@oh-my-pi/pi-tui html-form) decides the fields and their submitted
// data shape, so the web renders exactly what the TUI form would.
let formParser: HostMethod | null = null;

export function useOmpFormParser(module: unknown): void {
  const parse = field(module, "parseHtmlForm");
  if (isHostMethod(parse)) formParser = parse;
}

/** The host's parsed form, or null when this host has no parser. */
export function parseOmpForm(html: string): unknown {
  return formParser ? Reflect.apply(formParser, undefined, [html]) : null;
}

// Literal specifier: OMP's loader maps it to the bundled module only when
// spelled out (see native-state.ts). Absent outside OMP's executable.
try {
  patchOmpExtensionUiController(field(
    await import("@oh-my-pi/pi-coding-agent/modes/controllers/extension-ui-controller"),
    "ExtensionUiController",
  ));
} catch {}
try {
  useOmpFormParser(await import("@oh-my-pi/pi-tui/html-form/parse"));
} catch {}
