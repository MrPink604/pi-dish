import type fs = require('node:fs');
import type path = require('node:path');
import type { Browser, Page } from 'playwright';

export interface UiRegistryState {
  sessionId: string;
  socketPath: string;
  sessionFile: string;
  pid: number;
  startTime?: string | null;
  instanceId: string;
  cwd: string;
  name: string;
  model: string;
  contextUsage: { tokens: number; contextWindow: number; percent: number };
}

export interface UiScenarioContext {
  path: typeof path;
  fs: typeof fs;
  tmpHome: string;
  desktop: Page;
  browser: Browser;
  base: string;
  SESSION_ID: string;
  SKILL_SESSION_ID: string;
  BETA_ID: string;
  CWD: string;
  registryState: UiRegistryState;
  check(condition: unknown, label: string): void;
  watch(page: Page, label: string): Promise<void>;
  emit(event: string, data: unknown): void;
}

export type UiScenario = (context: UiScenarioContext) => Promise<void>;
