import { applyCachedTheme } from './themes';
import { installStartupGuard } from './startup-guard';
// The application bundle is deferred, so this is the first script that can
// notice a bundle that never loads or throws during startup.
installStartupGuard(document);
try { applyCachedTheme(document, localStorage); } catch { /* Storage may be disabled. */ }
