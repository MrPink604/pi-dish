import { applyCachedTheme } from './themes';
try { applyCachedTheme(document, localStorage); } catch { /* Storage may be disabled. */ }
