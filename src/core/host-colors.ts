export const HOST_COLOR_SLOTS = 5;

/** Only validated, own #rrggbb values may become CSS colors. */
export function sanitizeHostColors(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key && typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) entries.push([key, value.toLowerCase()]);
  }
  return Object.fromEntries(entries);
}

export function sanitizeHostColorOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const rows: unknown[] = raw;
  return [...new Set(rows.filter((item): item is string => typeof item === 'string' && !!item))];
}

/** First-seen slots remain stable; explicit overrides do not reorder hosts. */
export function assignHostColor(order: unknown, key: string, overrides: unknown) {
  const list = sanitizeHostColorOrder(order);
  const map = sanitizeHostColors(overrides);
  let index = list.indexOf(key);
  const appended = !!key && index < 0;
  if (appended) { list.push(key); index = list.length - 1; }
  const auto = index < 0 ? 'var(--text-muted)' : `var(--chart-${(index % HOST_COLOR_SLOTS) + 1})`;
  const custom = Object.prototype.hasOwnProperty.call(map, key);
  return { color: custom ? map[key] : auto, order: list, index, appended, custom };
}

export function rgbStringToHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value.trim());
  if (!match) return null;
  const part = (input: string) => Math.max(0, Math.min(255, Math.round(Number(input)))).toString(16).padStart(2, '0');
  return '#' + part(match[1]) + part(match[2]) + part(match[3]);
}
