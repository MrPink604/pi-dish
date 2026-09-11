import { assignHostColor, rgbStringToHex, sanitizeHostColorOrder, sanitizeHostColors } from '../core/host-colors';
import type { EffectiveHost } from './host-catalog';
import type { HostDirectory } from './host-directory';

type HostId = string | null | undefined;
export interface HostPresentationOptions {
  directory: HostDirectory;
  initialColors: unknown;
  initialOrder: unknown;
  persistColors: (colors: Readonly<Record<string, string>>) => void;
  persistOrder: (order: readonly string[]) => void;
  onColorChanged: (renderRows: boolean) => void;
  escapeHtml: (value: unknown) => string;
  displayLabel: (host: Readonly<EffectiveHost>) => string;
  isDown: (host: Readonly<EffectiveHost>) => boolean;
}

/** Device-local host colors; views never receive the mutable preference maps. */
export function createHostPresentation(options: HostPresentationOptions) {
  let overrides = sanitizeHostColors(options.initialColors);
  let order = sanitizeHostColorOrder(options.initialOrder);
  function keyFor(hostId: HostId): string {
    if (hostId) return hostId;
    const entry = options.directory.entryFor(null);
    return (entry && (entry.hostId || entry.key)) || 'self';
  }
  function colorFor(hostId: HostId): string {
    const assigned = assignHostColor(order, keyFor(hostId), overrides);
    if (assigned.appended) {
      order = assigned.order;
      try { options.persistOrder(order); } catch {}
    }
    return assigned.color;
  }
  function isCustom(hostId: HostId): boolean {
    return Object.prototype.hasOwnProperty.call(overrides, keyFor(hostId));
  }
  function setColor(hostId: HostId, hex: string | null, { rows = true } = {}): void {
    const key = keyFor(hostId);
    if (hex) overrides = { ...overrides, [key]: hex };
    else delete overrides[key];
    overrides = sanitizeHostColors(overrides);
    try { options.persistColors(overrides); } catch {}
    options.onColorChanged(rows);
  }
  function dotHtml(hostId: HostId, className = 'host-chip-dot'): string {
    return `<span class="${className}" style="--host-color:${options.escapeHtml(colorFor(hostId))}"></span>`;
  }

  /**
   * The host chip: a color dot, the label, and a faint tint of the host's color
   * on the hairline. Color-coded on purpose — across a fleet the color is what
   * the eye sorts by — but kept calm: this is context, not a status light, and
   * liveness stays the row dots' job. The unreachable form is the only
   * variation, and it is a word plus dimming, never an alarm color. Renders
   * nothing at all on a single host.
   */
  function chipHtml(hostId: HostId, { note = false } = {}): string {
    if (options.directory.effectiveHosts().length <= 1) return '';
    const entry = options.directory.entryFor(hostId);
    if (!entry) return '';
    const down = options.isDown(entry);
    const label = options.displayLabel(entry);
    const title = label + (down ? ' — unreachable, showing last known sessions' : '');
    return `<span class="host-chip${down ? ' offline' : ''}" style="--host-color:${options.escapeHtml(colorFor(hostId))}" title="${options.escapeHtml(title)}">` +
      `<span class="host-chip-dot"></span>${options.escapeHtml(label)}${down && note ? ' · unreachable' : ''}</span>`;
  }
  return { colorFor, isCustom, setColor, dotHtml, chipHtml };
}

/** Resolve a theme token through a temporary DOM probe for native color inputs. */
export function resolveColorToHex(color: string, doc: Document = document): string | null {
  const direct = rgbStringToHex(color);
  if (direct) return direct;
  const probe = doc.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  probe.style.color = color;
  doc.body.appendChild(probe);
  try { return rgbStringToHex(doc.defaultView?.getComputedStyle(probe).color); }
  finally { probe.remove(); }
}
