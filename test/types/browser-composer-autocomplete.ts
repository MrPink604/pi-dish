import type { createComposerAutocomplete } from '../../src/browser/composer-autocomplete';
import type { SlashCommand } from '../../src/browser/composer-autocomplete-data';
declare const autocomplete: ReturnType<typeof createComposerAutocomplete>;
declare const command: SlashCommand;
// @ts-expect-error autocomplete visibility is owned by its controller
autocomplete.visible = true;
// @ts-expect-error decoded command fields are immutable
command.name = 'changed';
// @ts-expect-error query text cannot be an arbitrary request object
autocomplete.handle({ query: 'a' });
