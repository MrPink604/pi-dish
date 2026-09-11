import { normalizeMood } from './helper-format';
import { record } from './helper-values';
import { decodeRenderMessage } from './message-data';
export function createMood(document: Document) {
function setMoodIndicator(description: unknown, face: unknown) {
  const inputArea = document.querySelector('.input-area');
  if (!inputArea) return;

  let el = document.getElementById('moodIndicator');
  const mood = normalizeMood(description, face);
  if (!mood) {
    el?.remove();
    return;
  }

  if (!el) {
    el = document.createElement('div');
    el.id = 'moodIndicator';
    el.className = 'mood-indicator';
    inputArea.insertBefore(el, inputArea.firstChild);
  }

  el.dataset.moodDescription = String(mood.description);
  el.dataset.moodFace = String(mood.face);
  el.textContent = `${mood.description} ${mood.face}`.trim();
}

function applyMoodFromTool(toolName: string, value: unknown) {
  const args = record(value) ? value : {};
  if (toolName !== 'set_mood') return;
  // Known set_mood arg shapes: {description, kaomoji} (the mood extension)
  // and {mood, label?} (footer-style variants — mood word or kaomoji, plus
  // an optional label).
  setMoodIndicator(args?.description ?? args?.label, args?.kaomoji || args?.face || args?.mood);
}

function updateMoodFromMessages(messages: readonly unknown[]) {
  for (const value of messages || []) {
    const msg = decodeRenderMessage(value);
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (typeof block !== 'string' && block?.type === 'toolCall' && block.name === 'set_mood') {
        applyMoodFromTool(block.name, block.arguments || {});
      }
    }
  }
}

return { set: setMoodIndicator, fromTool: applyMoodFromTool, fromMessages: updateMoodFromMessages };
}
