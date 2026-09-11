import { record, finite } from './helper-values';
import { stripAnsi } from './helper-format';
export interface ExtensionOption { readonly label: string; readonly description: string; readonly preview: string }
export interface ExtensionQuestion {
  readonly id: string; readonly question: string; readonly header: string; readonly multi: boolean; readonly recommended: number | null;
  readonly options: readonly ExtensionOption[];
}
export interface ExtensionRequest {
  readonly id: string; readonly method: string; readonly title: string; readonly message: string; readonly text: string; readonly prefill: string; readonly placeholder: string;
  readonly widgetKey: string; readonly widgetLines: readonly string[]; readonly widgetPlacement: string; readonly statusKey: string; readonly statusText: string;
  readonly notifyType: 'info' | 'warning' | 'error'; readonly options: readonly ExtensionOption[]; readonly questions: readonly ExtensionQuestion[];
}
export interface ExtensionAnswer {
  readonly id: string; readonly question: string; readonly options: readonly string[]; readonly multi: boolean;
  readonly selectedOptions: readonly string[]; readonly customInput?: string; readonly note?: string;
}
export type ExtensionResponse = { cancelled: true } | { confirmed: boolean } | { value: string | { kind: 'chat' } | { kind: 'submit'; results: readonly ExtensionAnswer[] } };
const text = (value: unknown) => typeof value === 'string' ? stripAnsi(value) : '';
function options(value: unknown): ExtensionOption[] {
  return Array.isArray(value) ? value.map((row: unknown) => typeof row === 'string'
    ? { label: text(row), description: '', preview: '' }
    : { label: record(row) ? text(row.label) : '', description: record(row) ? text(row.description) : '', preview: record(row) ? text(row.preview) : '' }) : [];
}
export function decodeExtensionRequest(value: unknown): ExtensionRequest | null {
  if (!record(value) || typeof value.method !== 'string') return null;
  return { id: typeof value.id === 'string' ? value.id : '', method: value.method,
    title: text(value.title), message: text(value.message), text: text(value.text), prefill: text(value.prefill), placeholder: text(value.placeholder),
    widgetKey: typeof value.widgetKey === 'string' && value.widgetKey ? value.widgetKey : 'default', widgetLines: Array.isArray(value.widgetLines) ? value.widgetLines.map(text) : [], widgetPlacement: text(value.widgetPlacement),
    statusKey: typeof value.statusKey === 'string' && value.statusKey ? value.statusKey : 'default', statusText: text(value.statusText), notifyType: value.notifyType === 'warning' || value.notifyType === 'error' ? value.notifyType : 'info',
    options: options(value.options), questions: Array.isArray(value.questions) ? value.questions.flatMap((row: unknown) => {
      if (!record(row) || typeof row.id !== 'string') return [];
      return [{ id: row.id, question: text(row.question), header: text(row.header), multi: row.multi === true,
        recommended: finite(row.recommended) && Number.isInteger(row.recommended) ? row.recommended : null, options: options(row.options) }];
    }) : [],
  };
}
