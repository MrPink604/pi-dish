import fs = require('fs');
import path = require('path');
import os = require('os');

function dishSettingsFile(): string {
  return path.join(os.homedir(), '.pi', 'dish', 'settings.json');
}

export function readDishSettings(): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(dishSettingsFile(), 'utf8'));
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export function writeDishSettings(settings: Record<string, unknown>): void {
  const file = dishSettingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
