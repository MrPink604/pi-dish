export { createHostTransport, createSessionApi, sendJson, withFetchTimeout, modelCatalogUrl, ApiHttpError } from './api-client';
export { decodeModelCatalog } from '../core/session-api';
export { mountModelSelector } from './model-selector';
export { createSessionState } from './session-state';
export { createHostConnections, hostKeyOf, hostConnReduce, HOST_BACKOFF_LADDER, HOST_BACKOFF_RESET_MS } from './host-connections';
export { createHostSessionLoader } from './host-session-loader';
export { mountThinkingSelector } from './thinking-selector';
export { normalizeHostBase, sanitizeHostCatalog, reconcileHostCatalog, mergeHostEntries } from './host-catalog';
export { createHarnessDiscovery } from './harness-discovery';
export { createHostDiscovery, decodeHostDescriptor } from './host-discovery';
export { createHostDirectory } from './host-directory';
export { createHostSettings, hostSettingsHtml } from './host-settings';
export { createHostPresentation, resolveColorToHex } from './host-presentation';
export { HOST_COLOR_SLOTS, sanitizeHostColors, sanitizeHostColorOrder, assignHostColor, rgbStringToHex } from '../core/host-colors';
export { sameDirectoryHost, createDirectoryCatalog, decodeKnownDirectories, decodeDirectoryChildren } from './directory-catalog';
export { createCwdAutocomplete } from './cwd-autocomplete';
export { createDirectoryTree } from './directory-tree';

export { createSpawnTargets, createSpawnTargetPicker, decodeSpawnChoices, spawnTargetKey } from './spawn-targets';

export { createModelCatalog, modelsCacheKey, modelSelectOptionsHtml, modelHiddenNote } from './model-catalog';

export { createNewSessionPreferences, createNewSessionConfigPreview, decodeHarnessConfigPreview, NS_THINKING_LABELS } from './new-session-options';

export { createHarnessSettings } from './harness-settings';
export { decodeHarnessConfig, decodeHarnessAgents } from './harness-settings-data';

export { createSessionSpawns, decodeSpawnId, decodeSpawnStatus, sessionSpawnKey } from './session-spawns';

export { createNewSession, NEW_SESSION_HARNESS_KEY } from './new-session';

export { createRecovery, decodeRecoveryMode, decodeRecoveryReport } from './recovery';

export { createBounce } from './bounce';
export { decodeBouncePreview, decodeBounceOperation, decodeBounceOperations } from './bounce-data';

export { createSessionRelations, decodeSessionRelations } from './session-relations';
export { createSessionSearch, decodeSessionSearch } from './session-search';

export { createSkills } from './skills';
export { decodeSkillDirectory, decodeSkillCoverage } from './skills-data';

export { createSearchView } from './search-view';
export { decodeSearchPayload, mergeSearchPayloads, queryHosts } from './search-data';

export { createUsageView } from './usage-view';
export { decodeUsageSummary, decodeUsageLimits } from './usage-data';

export { createThemes, decodeThemes, decodeThemeTokens, applyCachedTheme, terminalTheme } from './themes';
export { createPanelResize, clampSidebarWidth, clampTerminalHeight } from './panel-resize';
export { createDisplayPreferences, decodeSavedFilters, responseMode } from './display-preferences';

export { createTerminalController, decodeTerminalOutput } from './terminal';

export { createRoutinesView } from './routines-view';
export { decodeRoutine, decodeRoutineList, decodeRoutineInvocations } from './routines-data';

export { createSessionInfo } from './session-info';
export { decodeSessionStats, decodeSessionShare, decodePublishedPages } from './session-info-data';

export { createTranscriptTree } from './transcript-tree';
export { decodeTranscriptTree } from './transcript-tree-data';

export { createBrowserAssets } from './browser-assets';
export { createRichText } from './rich-text';
export { createDiagrams } from './diagrams';
export { copyTextToClipboard } from './clipboard';

export { createExtensionUI } from './extension-ui';
export { decodeExtensionRequest } from './extension-ui-data';

export { createFileViews } from './file-views';
export { decodeFilePreview, decodeDiffView, decodeDiffPatch } from './file-view-data';
export { renderDiffViewHtml } from './file-view-render';

export { createAnchoredComments } from './anchored-comments';
export { decodeAnchoredComments, decodeCommentTarget, decodeCommentIndex } from './anchored-comment-data';
export { selectionTextAnchor, findQuoteOffset, markCommentQuote } from './comment-anchors';

export { createSessionControls } from './session-controls';

export { createComposerNotes } from './composer-notes';
export { createComposerSpeech } from './composer-speech';

export { createComposerImages, decodeComposerImages } from './composer-images';
export { createComposerDrafts, mergeComposerText } from './composer-drafts';

export { createSessionReferences } from './session-references';
export { createComposerAutocomplete } from './composer-autocomplete';
export { decodeSlashCommands, decodeFileCompletions } from './composer-autocomplete-data';
