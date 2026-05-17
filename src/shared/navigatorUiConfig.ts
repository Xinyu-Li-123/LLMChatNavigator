import type { ChatProvider } from './types';

export type Position = {
  x: number;
  y: number;
};

export type PaneSide = 'auto' | 'left' | 'right';

export type FloatingPaneConfig = {
  width: number;
  height: number;
  position: Position | null;
  side: PaneSide;
};

export type ProviderUiConfig = {
  floatingButtonPosition: Position | null;
  pane: FloatingPaneConfig;
};

export type NavigatorTheme = 'light' | 'dark';

export type ExtensionUiConfig = {
  theme: NavigatorTheme;
  utilityRowCollapsed: boolean;
};

export type NavigatorUiConfig = Partial<Record<ChatProvider, ProviderUiConfig>>;

export const NAVIGATOR_UI_CONFIG_STORAGE_KEY = 'llm-chat-navigator:ui-config:v1';
export const EXTENSION_UI_CONFIG_STORAGE_KEY = 'llm-chat-navigator:extension-ui-config:v1';

const DEFAULT_EXTENSION_CONFIG: ExtensionUiConfig = {
  theme: 'light',
  utilityRowCollapsed: false,
};

const DEFAULT_PROVIDER_CONFIG: ProviderUiConfig = {
  floatingButtonPosition: null,
  pane: {
    width: 420,
    height: 620,
    position: null,
    side: 'auto',
  },
};

function isPosition(value: unknown): value is Position {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Position>;
  return typeof candidate.x === 'number' && typeof candidate.y === 'number';
}

function isPaneSide(value: unknown): value is PaneSide {
  return value === 'auto' || value === 'left' || value === 'right';
}

function isNavigatorTheme(value: unknown): value is NavigatorTheme {
  return value === 'light' || value === 'dark';
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function defaultExtensionUiConfig(): ExtensionUiConfig {
  return { ...DEFAULT_EXTENSION_CONFIG };
}

export function normalizeExtensionUiConfig(value: unknown): ExtensionUiConfig {
  const defaults = defaultExtensionUiConfig();
  if (!value || typeof value !== 'object') return defaults;

  const candidate = value as Partial<ExtensionUiConfig>;
  return {
    theme: isNavigatorTheme(candidate.theme) ? candidate.theme : defaults.theme,
    utilityRowCollapsed: typeof candidate.utilityRowCollapsed === 'boolean'
      ? candidate.utilityRowCollapsed
      : defaults.utilityRowCollapsed,
  };
}

export function defaultProviderUiConfig(): ProviderUiConfig {
  return {
    floatingButtonPosition: DEFAULT_PROVIDER_CONFIG.floatingButtonPosition,
    pane: { ...DEFAULT_PROVIDER_CONFIG.pane },
  };
}

export function normalizeProviderUiConfig(value: unknown): ProviderUiConfig {
  const defaults = defaultProviderUiConfig();
  if (!value || typeof value !== 'object') return defaults;

  const candidate = value as Partial<ProviderUiConfig>;
  const pane = candidate.pane && typeof candidate.pane === 'object' ? candidate.pane as Partial<FloatingPaneConfig> : {};

  return {
    floatingButtonPosition: isPosition(candidate.floatingButtonPosition) ? candidate.floatingButtonPosition : null,
    pane: {
      width: numberOrDefault(pane.width, defaults.pane.width),
      height: numberOrDefault(pane.height, defaults.pane.height),
      position: isPosition(pane.position) ? pane.position : null,
      side: isPaneSide(pane.side) ? pane.side : defaults.pane.side,
    },
  };
}

export async function loadNavigatorUiConfig(): Promise<NavigatorUiConfig> {
  const result = await browser.storage.local.get(NAVIGATOR_UI_CONFIG_STORAGE_KEY);
  const stored = result[NAVIGATOR_UI_CONFIG_STORAGE_KEY];
  return stored && typeof stored === 'object' ? stored as NavigatorUiConfig : {};
}

export async function loadExtensionUiConfig(): Promise<ExtensionUiConfig> {
  const result = await browser.storage.local.get(EXTENSION_UI_CONFIG_STORAGE_KEY);
  return normalizeExtensionUiConfig(result[EXTENSION_UI_CONFIG_STORAGE_KEY]);
}

export async function saveExtensionUiConfig(extensionConfig: ExtensionUiConfig): Promise<void> {
  await browser.storage.local.set({
    [EXTENSION_UI_CONFIG_STORAGE_KEY]: normalizeExtensionUiConfig(extensionConfig),
  });
}

export async function loadProviderUiConfig(provider: ChatProvider): Promise<ProviderUiConfig> {
  const config = await loadNavigatorUiConfig();
  return normalizeProviderUiConfig(config[provider]);
}

export async function saveProviderUiConfig(provider: ChatProvider, providerConfig: ProviderUiConfig): Promise<void> {
  const config = await loadNavigatorUiConfig();
  await browser.storage.local.set({
    [NAVIGATOR_UI_CONFIG_STORAGE_KEY]: {
      ...config,
      [provider]: normalizeProviderUiConfig(providerConfig),
    },
  });
}
