import type { Theme } from '../../src/browser/themes';
import type { createDisplayPreferences } from '../../src/browser/display-preferences';
declare const theme: Theme;
declare const preferences: ReturnType<typeof createDisplayPreferences>;
// @ts-expect-error theme snapshots are immutable
theme.tokens['--accent'] = 'red';
// @ts-expect-error preferences mutate through owned controls
preferences.responseMode = 'performance';
// @ts-expect-error preferences expose only supported context readouts
const metric: 'calls' = preferences.contextMetric;
