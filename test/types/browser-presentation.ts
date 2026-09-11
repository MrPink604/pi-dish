import { createHostPresentation, resolveColorToHex } from '../../src/browser/host-presentation';
import { createHostSettings } from '../../src/browser/host-settings';
import type { HostSettingsOptions } from '../../src/browser/host-settings';
import type { HostDirectory } from '../../src/browser/host-directory';

declare const directory: HostDirectory;
declare const settings: Omit<HostSettingsOptions, 'directory' | 'color' | 'customColor' | 'resolveColor' | 'setColor'>;
const presentation = createHostPresentation({
  directory, initialColors: {}, initialOrder: [],
  escapeHtml: settings.escapeHtml, displayLabel: settings.displayLabel, isDown: settings.connections.isDown,
  persistColors: colors => {
    // @ts-expect-error Persistence receives a readonly preference snapshot.
    colors.peer = '#ffffff';
  },
  persistOrder: order => {
    // @ts-expect-error The first-seen order belongs to the color controller.
    order.push('peer');
  },
  onColorChanged: renderRows => { const value: boolean = renderRows; void value; },
});
const view = createHostSettings({ ...settings, directory, color: presentation.colorFor,
  customColor: presentation.isCustom, setColor: presentation.setColor, resolveColor: resolveColorToHex });
view.mount(document.body);
view.unmount();
// @ts-expect-error A view may set a color string or reset it; wire objects are not colors.
presentation.setColor('peer', { color: '#ffffff' });
// @ts-expect-error Mount requires a DOM view, not a selector string.
view.mount('#settingsBody');
