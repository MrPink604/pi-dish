// Pi-dish emulation metadata only: the upstream Pi TUI mirror and each
// transport's availability/routing policy remain with their existing owners.
export const PI_EMULATED_THINKING_LEVELS: readonly string[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

export const EMULATED_COMMAND_METADATA = {
  compact: { name: 'compact', description: 'Manually compact the session context', args: '[instructions]' },
  model: { name: 'model', description: 'Switch model (usage: /model provider/model-id)', args: '<model>' },
  name: { name: 'name', description: 'Set session display name', args: '<name>' },
  thinking: { name: 'thinking', description: 'Set thinking level', args: `<${PI_EMULATED_THINKING_LEVELS.join('|')}>` },
  abort: { name: 'abort', description: 'Abort the current agent operation' },
  reload: { name: 'reload', description: 'Reload extensions, skills, and prompt templates' },
  btw: { name: 'btw', description: 'Ask an ephemeral side question using the current session context' },
} as const;
