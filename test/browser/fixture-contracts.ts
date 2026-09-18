import type { Terminal } from '@xterm/xterm';
import type { HostEndpoint } from '../../src/browser/api-client.js';

/** Private exact projections for the application-observation browser fixture. */
export interface FixtureFactories {
  hostView: typeof import('../../src/browser/host-view.js').createHostView;
  hostDirectory: typeof import('../../src/browser/host-directory.js').createHostDirectory;
  apiTransport: typeof import('../../src/browser/api-client.js').createHostTransport;
  sessionApi: typeof import('../../src/browser/api-client.js').createSessionApi;
  hostConnections: typeof import('../../src/browser/host-connections.js').createHostConnections;
  hostDiscovery: typeof import('../../src/browser/host-discovery.js').createHostDiscovery;
  hostPresentation: typeof import('../../src/browser/host-presentation.js').createHostPresentation;
  sessionState: typeof import('../../src/browser/session-state.js').createSessionState;
  responseDetailsController: typeof import('../../src/browser/response-details.js').createResponseDetails;
  appChrome: typeof import('../../src/browser/app-chrome.js').createAppChrome;
  sessionReferences: typeof import('../../src/browser/session-references.js').createSessionReferences;
  composerAutocomplete: typeof import('../../src/browser/composer-autocomplete.js').createComposerAutocomplete;
  sidebarActivity: typeof import('../../src/browser/sidebar-activity.js').createSidebarActivity;
  sidebarQuery: typeof import('../../src/browser/sidebar-query.js').createSidebarQuery;
  sidebarLists: typeof import('../../src/browser/sidebar-lists.js').createSidebarLists;
  sidebarControls: typeof import('../../src/browser/sidebar-controls.js').createSidebarControls;
  sessionView: typeof import('../../src/browser/session-view.js').createSessionView;
  sessionResume: typeof import('../../src/browser/session-resume.js').createSessionResume;
  modelCatalog: typeof import('../../src/browser/model-catalog.js').createModelCatalog;
  appModels: typeof import('../../src/browser/app-models.js').createAppModels;
  sessionRelationsController: typeof import('../../src/browser/session-relations.js').createSessionRelations;
  sessionHeader: typeof import('../../src/browser/session-header.js').createSessionHeader;
  sessionControls: typeof import('../../src/browser/session-controls.js').createSessionControls;
  sessionSearch: typeof import('../../src/browser/session-search.js').createSessionSearch;
  displayPreferences: typeof import('../../src/browser/display-preferences.js').createDisplayPreferences;
  recoveryController: typeof import('../../src/browser/recovery.js').createRecovery;
  hostSettings: typeof import('../../src/browser/host-settings.js').createHostSettings;
  searchViewController: typeof import('../../src/browser/search-view.js').createSearchView;
  skillsController: typeof import('../../src/browser/skills.js').createSkills;
  usageController: typeof import('../../src/browser/usage-view.js').createUsageView;
  sessionInfo: typeof import('../../src/browser/session-info.js').createSessionInfo;
  fileViews: typeof import('../../src/browser/file-views.js').createFileViews;
  anchoredCommentController: typeof import('../../src/browser/anchored-comments.js').createAnchoredComments;
  transcriptController: typeof import('../../src/browser/transcript.js').createTranscript;
  messageRenderer: typeof import('../../src/browser/message-render.js').createMessageRenderer;
  subagentsController: typeof import('../../src/browser/subagents-view.js').createSubagentsView;
  liveToolsController: typeof import('../../src/browser/live-tools.js').createLiveTools;
  messageStreamController: typeof import('../../src/browser/message-stream.js').createMessageStream;
  composerDrafts: typeof import('../../src/browser/composer-drafts.js').createComposerDrafts;
  composerNotes: typeof import('../../src/browser/composer-notes.js').createComposerNotes;
  composerSpeech: typeof import('../../src/browser/composer-speech.js').createComposerSpeech;
  promptDelivery: typeof import('../../src/browser/prompt-delivery.js').createPromptDelivery;
  sessionActivity: typeof import('../../src/browser/session-activity.js').createSessionActivity;
  btwPanel: typeof import('../../src/browser/btw-panel.js').createBtwPanel;
  composerSubmit: typeof import('../../src/browser/composer-submit.js').createComposerSubmit;
  pendingSessionSpawns: typeof import('../../src/browser/session-spawns.js').createSessionSpawns;
  newSessionController: typeof import('../../src/browser/new-session.js').createNewSession;
  harnessSettingsController: typeof import('../../src/browser/harness-settings.js').createHarnessSettings;
  streamingRenderer: typeof import('../../src/browser/streaming-render.js').createStreamingRenderer;
  moodController: typeof import('../../src/browser/mood.js').createMood;
  extensionUI: typeof import('../../src/browser/extension-ui.js').createExtensionUI;
  browserAssets: typeof import('../../src/browser/browser-assets.js').createBrowserAssets;
  diagramRenderer: typeof import('../../src/browser/diagrams.js').createDiagrams;
  richText: typeof import('../../src/browser/rich-text.js').createRichText;
  transcriptTree: typeof import('../../src/browser/transcript-tree.js').createTranscriptTree;
  themesController: typeof import('../../src/browser/themes.js').createThemes;
  terminalController: typeof import('../../src/browser/terminal.js').createTerminalController;
  panelResize: typeof import('../../src/browser/panel-resize.js').createPanelResize;
  routinesController: typeof import('../../src/browser/routines-view.js').createRoutinesView;
  bounceController: typeof import('../../src/browser/bounce.js').createBounce;
  mainPane: typeof import('../../src/browser/main-pane.js').createMainPane;
  appBindings: typeof import('../../src/browser/app-bindings.js').createAppBindings;
}

export interface FixtureFeatures {
  hostView: ReturnType<typeof import('../../src/browser/host-view.js').createHostView>;
  hostDirectory: ReturnType<typeof import('../../src/browser/host-directory.js').createHostDirectory>;
  apiTransport: ReturnType<typeof import('../../src/browser/api-client.js').createHostTransport>;
  sessionApi: ReturnType<typeof import('../../src/browser/api-client.js').createSessionApi>;
  hostConnections: ReturnType<typeof import('../../src/browser/host-connections.js').createHostConnections>;
  hostDiscovery: ReturnType<typeof import('../../src/browser/host-discovery.js').createHostDiscovery>;
  hostPresentation: ReturnType<typeof import('../../src/browser/host-presentation.js').createHostPresentation>;
  sessionState: ReturnType<typeof import('../../src/browser/session-state.js').createSessionState>;
  responseDetailsController: ReturnType<typeof import('../../src/browser/response-details.js').createResponseDetails>;
  appChrome: ReturnType<typeof import('../../src/browser/app-chrome.js').createAppChrome>;
  sessionReferences: ReturnType<typeof import('../../src/browser/session-references.js').createSessionReferences>;
  composerAutocomplete: ReturnType<typeof import('../../src/browser/composer-autocomplete.js').createComposerAutocomplete>;
  sidebarActivity: ReturnType<typeof import('../../src/browser/sidebar-activity.js').createSidebarActivity>;
  sidebarQuery: ReturnType<typeof import('../../src/browser/sidebar-query.js').createSidebarQuery>;
  sidebarLists: ReturnType<typeof import('../../src/browser/sidebar-lists.js').createSidebarLists>;
  sidebarControls: ReturnType<typeof import('../../src/browser/sidebar-controls.js').createSidebarControls>;
  sessionView: ReturnType<typeof import('../../src/browser/session-view.js').createSessionView>;
  sessionResume: ReturnType<typeof import('../../src/browser/session-resume.js').createSessionResume>;
  modelCatalog: ReturnType<typeof import('../../src/browser/model-catalog.js').createModelCatalog>;
  appModels: ReturnType<typeof import('../../src/browser/app-models.js').createAppModels>;
  sessionRelationsController: ReturnType<typeof import('../../src/browser/session-relations.js').createSessionRelations>;
  sessionHeader: ReturnType<typeof import('../../src/browser/session-header.js').createSessionHeader>;
  sessionControls: ReturnType<typeof import('../../src/browser/session-controls.js').createSessionControls>;
  sessionSearch: ReturnType<typeof import('../../src/browser/session-search.js').createSessionSearch>;
  displayPreferences: ReturnType<typeof import('../../src/browser/display-preferences.js').createDisplayPreferences>;
  recoveryController: ReturnType<typeof import('../../src/browser/recovery.js').createRecovery>;
  hostSettings: ReturnType<typeof import('../../src/browser/host-settings.js').createHostSettings>;
  searchViewController: ReturnType<typeof import('../../src/browser/search-view.js').createSearchView>;
  skillsController: ReturnType<typeof import('../../src/browser/skills.js').createSkills>;
  usageController: ReturnType<typeof import('../../src/browser/usage-view.js').createUsageView>;
  sessionInfo: ReturnType<typeof import('../../src/browser/session-info.js').createSessionInfo>;
  fileViews: ReturnType<typeof import('../../src/browser/file-views.js').createFileViews>;
  anchoredCommentController: ReturnType<typeof import('../../src/browser/anchored-comments.js').createAnchoredComments>;
  transcriptController: ReturnType<typeof import('../../src/browser/transcript.js').createTranscript>;
  messageRenderer: ReturnType<typeof import('../../src/browser/message-render.js').createMessageRenderer>;
  subagentsController: ReturnType<typeof import('../../src/browser/subagents-view.js').createSubagentsView>;
  liveToolsController: ReturnType<typeof import('../../src/browser/live-tools.js').createLiveTools>;
  messageStreamController: ReturnType<typeof import('../../src/browser/message-stream.js').createMessageStream>;
  composerDrafts: ReturnType<typeof import('../../src/browser/composer-drafts.js').createComposerDrafts>;
  composerNotes: ReturnType<typeof import('../../src/browser/composer-notes.js').createComposerNotes>;
  composerSpeech: ReturnType<typeof import('../../src/browser/composer-speech.js').createComposerSpeech>;
  promptDelivery: ReturnType<typeof import('../../src/browser/prompt-delivery.js').createPromptDelivery>;
  sessionActivity: ReturnType<typeof import('../../src/browser/session-activity.js').createSessionActivity>;
  btwPanel: ReturnType<typeof import('../../src/browser/btw-panel.js').createBtwPanel>;
  composerSubmit: ReturnType<typeof import('../../src/browser/composer-submit.js').createComposerSubmit>;
  pendingSessionSpawns: ReturnType<typeof import('../../src/browser/session-spawns.js').createSessionSpawns>;
  newSessionController: ReturnType<typeof import('../../src/browser/new-session.js').createNewSession>;
  harnessSettingsController: ReturnType<typeof import('../../src/browser/harness-settings.js').createHarnessSettings>;
  streamingRenderer: ReturnType<typeof import('../../src/browser/streaming-render.js').createStreamingRenderer>;
  moodController: ReturnType<typeof import('../../src/browser/mood.js').createMood>;
  extensionUI: ReturnType<typeof import('../../src/browser/extension-ui.js').createExtensionUI>;
  browserAssets: ReturnType<typeof import('../../src/browser/browser-assets.js').createBrowserAssets>;
  diagramRenderer: ReturnType<typeof import('../../src/browser/diagrams.js').createDiagrams>;
  richText: ReturnType<typeof import('../../src/browser/rich-text.js').createRichText>;
  transcriptTree: ReturnType<typeof import('../../src/browser/transcript-tree.js').createTranscriptTree>;
  themesController: ReturnType<typeof import('../../src/browser/themes.js').createThemes>;
  terminalController: ReturnType<typeof import('../../src/browser/terminal.js').createTerminalController>;
  panelResize: ReturnType<typeof import('../../src/browser/panel-resize.js').createPanelResize>;
  routinesController: ReturnType<typeof import('../../src/browser/routines-view.js').createRoutinesView>;
  bounceController: ReturnType<typeof import('../../src/browser/bounce.js').createBounce>;
  mainPane: ReturnType<typeof import('../../src/browser/main-pane.js').createMainPane>;
  appBindings: ReturnType<typeof import('../../src/browser/app-bindings.js').createAppBindings>;
}

export interface FixturePorts {
  hostDiscovery: Parameters<typeof import('../../src/browser/host-discovery.js').createHostDiscovery>[0];
  sessionState: Parameters<typeof import('../../src/browser/session-state.js').createSessionState>[0];
  sidebarControls: Parameters<typeof import('../../src/browser/sidebar-controls.js').createSidebarControls>[0];
  appModels: Parameters<typeof import('../../src/browser/app-models.js').createAppModels>[0];
  sessionControls: Parameters<typeof import('../../src/browser/session-controls.js').createSessionControls>[0];
  usageController: Parameters<typeof import('../../src/browser/usage-view.js').createUsageView>[0];
  transcriptController: Parameters<typeof import('../../src/browser/transcript.js').createTranscript>[0];
  messageStreamController: Parameters<typeof import('../../src/browser/message-stream.js').createMessageStream>[0];
  composerDrafts: Parameters<typeof import('../../src/browser/composer-drafts.js').createComposerDrafts>[0];
  composerSubmit: Parameters<typeof import('../../src/browser/composer-submit.js').createComposerSubmit>[0];
  newSessionController: Parameters<typeof import('../../src/browser/new-session.js').createNewSession>[0];
  routinesController: Parameters<typeof import('../../src/browser/routines-view.js').createRoutinesView>[0];
  appBindings: Parameters<typeof import('../../src/browser/app-bindings.js').createAppBindings>[0];
}

export interface FixtureRegistry {
  features: FixtureFeatures;
  ports: FixturePorts;
}

export interface FixtureObservationRegistry {
  features: Partial<FixtureFeatures>;
  ports: Partial<FixturePorts>;
}
export interface FixtureSocket extends WebSocket {
  closeCalls: number;
  sent: unknown[];
}

export interface FixtureTerminal extends Terminal {
  disposed: boolean;
  emitData(value: string): void;
  emitResize(size: { cols: number; rows: number }): void;
  setApplicationCursorKeys(enabled: boolean): Promise<void>;
}
export interface TerminalProbe {
  writes: string[];
  sockets: FixtureSocket[];
  terminals: FixtureTerminal[];
  tickets: ((ticket: string) => void)[];
  host?: HostEndpoint | null;
  controller?: FixtureFeatures['terminalController'];
  finishAssets?: () => void;
  pending?: Promise<void>;
  originalFont?: FontFaceSet['load'];
  finishFont?: (faces: FontFace[]) => void;
}
export interface CompleteTerminalProbe extends TerminalProbe {
  controller: FixtureFeatures['terminalController'];
}
export interface SidebarControlsLog {
  render: number;
  copied: string[];
  statuses: unknown[];
  closes: unknown[];
  refresh: number;
  selected: unknown[];
  request?: { host: unknown; path: string; method: string | undefined };
}

export interface SidebarQueryLog {
  loads: string[];
  invalidations: number;
  busy: unknown[];
  render: number;
  search: number;
  alerts: unknown[];
}

export interface SidebarQueryReply {
  host: unknown;
  path: string;
  init: RequestInit | undefined;
  resolve(value: Response): void;
}




export const FEATURE_FACTORY_NAMES = {
  hostView: 'createHostView',
  hostDirectory: 'createHostDirectory',
  apiTransport: 'createHostTransport',
  sessionApi: 'createSessionApi',
  hostConnections: 'createHostConnections',
  hostDiscovery: 'createHostDiscovery',
  hostPresentation: 'createHostPresentation',
  sessionState: 'createSessionState',
  responseDetailsController: 'createResponseDetails',
  appChrome: 'createAppChrome',
  sessionReferences: 'createSessionReferences',
  composerAutocomplete: 'createComposerAutocomplete',
  sidebarActivity: 'createSidebarActivity',
  sidebarQuery: 'createSidebarQuery',
  sidebarLists: 'createSidebarLists',
  sidebarControls: 'createSidebarControls',
  sessionView: 'createSessionView',
  sessionResume: 'createSessionResume',
  modelCatalog: 'createModelCatalog',
  appModels: 'createAppModels',
  sessionRelationsController: 'createSessionRelations',
  sessionHeader: 'createSessionHeader',
  sessionControls: 'createSessionControls',
  sessionSearch: 'createSessionSearch',
  displayPreferences: 'createDisplayPreferences',
  recoveryController: 'createRecovery',
  hostSettings: 'createHostSettings',
  searchViewController: 'createSearchView',
  skillsController: 'createSkills',
  usageController: 'createUsageView',
  sessionInfo: 'createSessionInfo',
  fileViews: 'createFileViews',
  anchoredCommentController: 'createAnchoredComments',
  transcriptController: 'createTranscript',
  messageRenderer: 'createMessageRenderer',
  subagentsController: 'createSubagentsView',
  liveToolsController: 'createLiveTools',
  messageStreamController: 'createMessageStream',
  composerDrafts: 'createComposerDrafts',
  composerNotes: 'createComposerNotes',
  composerSpeech: 'createComposerSpeech',
  promptDelivery: 'createPromptDelivery',
  sessionActivity: 'createSessionActivity',
  btwPanel: 'createBtwPanel',
  composerSubmit: 'createComposerSubmit',
  pendingSessionSpawns: 'createSessionSpawns',
  newSessionController: 'createNewSession',
  harnessSettingsController: 'createHarnessSettings',
  streamingRenderer: 'createStreamingRenderer',
  moodController: 'createMood',
  extensionUI: 'createExtensionUI',
  browserAssets: 'createBrowserAssets',
  diagramRenderer: 'createDiagrams',
  richText: 'createRichText',
  transcriptTree: 'createTranscriptTree',
  themesController: 'createThemes',
  terminalController: 'createTerminalController',
  panelResize: 'createPanelResize',
  routinesController: 'createRoutinesView',
  bounceController: 'createBounce',
  mainPane: 'createMainPane',
  appBindings: 'createAppBindings',
} as const satisfies Record<keyof FixtureFeatures, string>;

export const FIXTURE_FEATURE_NAMES = ['hostView', 'hostDirectory', 'apiTransport', 'sessionApi', 'hostConnections', 'hostDiscovery', 'hostPresentation', 'sessionState', 'responseDetailsController', 'appChrome', 'sessionReferences', 'composerAutocomplete', 'sidebarActivity', 'sidebarQuery', 'sidebarLists', 'sidebarControls', 'sessionView', 'sessionResume', 'modelCatalog', 'appModels', 'sessionRelationsController', 'sessionHeader', 'sessionControls', 'sessionSearch', 'displayPreferences', 'recoveryController', 'hostSettings', 'searchViewController', 'skillsController', 'usageController', 'sessionInfo', 'fileViews', 'anchoredCommentController', 'transcriptController', 'messageRenderer', 'subagentsController', 'liveToolsController', 'messageStreamController', 'composerDrafts', 'composerNotes', 'composerSpeech', 'promptDelivery', 'sessionActivity', 'btwPanel', 'composerSubmit', 'pendingSessionSpawns', 'newSessionController', 'harnessSettingsController', 'streamingRenderer', 'moodController', 'extensionUI', 'browserAssets', 'diagramRenderer', 'richText', 'transcriptTree', 'themesController', 'terminalController', 'panelResize', 'routinesController', 'bounceController', 'mainPane', 'appBindings'] as const satisfies readonly (keyof FixtureFeatures)[];

export const FIXTURE_PORT_NAMES = ['appBindings', 'appModels', 'composerDrafts', 'composerSubmit', 'hostDiscovery', 'messageStreamController', 'newSessionController', 'routinesController', 'sessionControls', 'sessionState', 'sidebarControls', 'transcriptController', 'usageController'] as const satisfies readonly (keyof FixturePorts)[];

export type FixtureFeatureName = keyof FixtureFeatures;
