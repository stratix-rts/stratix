import type { LLMProvider } from '@/stratix-core/stratix-protocol';
import builtInProviders from '@/config/providers.config.json';
import customProvidersDefault from '@/config/custom-providers.config.json';
import { browserStorage } from '../core/BrowserStorage';

export interface ProviderConfig {
  name: string;
  icon: string;
  requiresApiKey: boolean;
  defaultEndpoint: string;
  models: string[];
  envKey: string | null;
  isCustom?: boolean;
}

interface ProvidersConfigJson {
  providers: Record<string, ProviderConfig>;
  providerOrder: string[];
}

const builtInConfig = builtInProviders as ProvidersConfigJson;
const defaultCustomConfig = customProvidersDefault as ProvidersConfigJson;

let customConfig: ProvidersConfigJson = { ...defaultCustomConfig };
let configLoaded = false;
let cachedProviderConfigs: Record<string, ProviderConfig> = { ...builtInConfig.providers };
let cachedProviderList: string[] = [...builtInConfig.providerOrder];

async function loadCustomConfig(): Promise<void> {
  if (configLoaded) return;

  if (typeof window !== 'undefined' && (window as any).electronAPI?.config?.loadCustomProviders) {
    try {
      const result = await (window as any).electronAPI.config.loadCustomProviders();
      if (result.success && result.data) {
        customConfig = JSON.parse(result.data);
      }
    } catch (error) {
      console.error('[ProviderConfig] Failed to load custom providers:', error);
    }
  } else {
    // Browser environment: load from browserStorage
    try {
      const stored = await browserStorage.get<ProvidersConfigJson>('customProviders');
      if (stored) {
        customConfig = stored;
      }
    } catch (error) {
      console.error('[ProviderConfig] Failed to load custom providers from browserStorage:', error);
    }
  }
  configLoaded = true;
}

function rebuildCache(): void {
  cachedProviderConfigs = { ...builtInConfig.providers };
  cachedProviderList = [...builtInConfig.providerOrder];
  
  for (const key of Object.keys(customConfig.providers)) {
    cachedProviderConfigs[key] = {
      ...customConfig.providers[key],
      isCustom: true,
    };
    if (!cachedProviderList.includes(key)) {
      cachedProviderList.push(key);
    }
  }
}

export async function initProviderConfig(): Promise<void> {
  await loadCustomConfig();
  rebuildCache();
}

export function getBuiltInProviderConfigs(): Record<string, ProviderConfig> {
  return { ...builtInConfig.providers };
}

export function getBuiltInProviderList(): string[] {
  return [...builtInConfig.providerOrder];
}

export function getCustomProviderConfigs(): Record<string, ProviderConfig> {
  return { ...customConfig.providers };
}

export function getCustomProviderList(): string[] {
  return [...customConfig.providerOrder];
}

export async function getAllProviderConfigs(): Promise<Record<string, ProviderConfig>> {
  await loadCustomConfig();
  
  const builtIn = getBuiltInProviderConfigs();
  const custom = getCustomProviderConfigs();
  
  const merged: Record<string, ProviderConfig> = { ...builtIn };
  
  for (const key of Object.keys(custom)) {
    merged[key] = {
      ...custom[key],
      isCustom: true,
    };
  }
  
  return merged;
}

export async function getAllProviderList(): Promise<string[]> {
  await loadCustomConfig();
  return [...getBuiltInProviderList(), ...getCustomProviderList()];
}

export async function getProviderConfigs(): Promise<Record<string, ProviderConfig>> {
  return await getAllProviderConfigs();
}

export async function getProviderList(): Promise<string[]> {
  return await getAllProviderList();
}

export const BUILT_IN_PROVIDER_LIST: string[] = getBuiltInProviderList();

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = getBuiltInProviderConfigs();

export const PROVIDER_LIST: string[] = getBuiltInProviderList();

export async function getCUSTOM_PROVIDER_LIST(): Promise<string[]> {
  await loadCustomConfig();
  return getCustomProviderList();
}

export async function addCustomProvider(
  providerId: string,
  config: Omit<ProviderConfig, 'isCustom'>
): Promise<{ success: boolean; message: string }> {
  await loadCustomConfig();
  
  if (builtInConfig.providers[providerId]) {
    return { success: false, message: `Provider "${providerId}" already exists in built-in` };
  }
  
  if (customConfig.providers[providerId]) {
    return { success: false, message: `Provider "${providerId}" already exists` };
  }

  const newCustomProviders = {
    ...customConfig.providers,
    [providerId]: {
      ...config,
      isCustom: true,
    },
  };

  const newCustomConfig: ProvidersConfigJson = {
    providers: newCustomProviders,
    providerOrder: [...customConfig.providerOrder, providerId],
  };

  customConfig = newCustomConfig;
  rebuildCache();

  // Electron environment: save to file
  if (typeof window !== 'undefined' && (window as any).electronAPI?.config?.saveCustomProviders) {
    try {
      await (window as any).electronAPI.config.saveCustomProviders(JSON.stringify(newCustomConfig, null, 2));
    } catch (error) {
      console.error('[ProviderConfig] Failed to save custom providers:', error);
      return { success: false, message: 'Failed to save configuration' };
    }
  } else {
    // Browser environment: save to browserStorage
    try {
      await browserStorage.set('customProviders', newCustomConfig);
    } catch (error) {
      console.error('[ProviderConfig] Failed to save custom providers to browserStorage:', error);
      return { success: false, message: 'Failed to save configuration' };
    }
  }

  return { success: true, message: `Provider "${config.name}" added successfully` };
}

export async function removeCustomProvider(providerId: string): Promise<{ success: boolean; message: string }> {
  await loadCustomConfig();
  
  if (!customConfig.providers[providerId]) {
    return { success: false, message: `Custom provider "${providerId}" not found` };
  }

  const newCustomProviders = { ...customConfig.providers };
  delete newCustomProviders[providerId];

  const newCustomConfig: ProvidersConfigJson = {
    providers: newCustomProviders,
    providerOrder: customConfig.providerOrder.filter((p) => p !== providerId),
  };

  customConfig = newCustomConfig;
  rebuildCache();

  // Electron environment: save to file
  if (typeof window !== 'undefined' && (window as any).electronAPI?.config?.saveCustomProviders) {
    try {
      await (window as any).electronAPI.config.saveCustomProviders(JSON.stringify(newCustomConfig, null, 2));
    } catch (error) {
      return { success: false, message: 'Failed to save configuration' };
    }
  } else {
    // Browser environment: save to browserStorage
    try {
      await browserStorage.set('customProviders', newCustomConfig);
    } catch (error) {
      return { success: false, message: 'Failed to save configuration' };
    }
  }

  return { success: true, message: `Provider "${providerId}" removed` };
}

export function isBuiltInProvider(providerId: string): boolean {
  return builtInConfig.providerOrder.includes(providerId);
}

export async function isCustomProvider(providerId: string): Promise<boolean> {
  await loadCustomConfig();
  return customConfig.providerOrder.includes(providerId);
}

export function getCachedProviderConfigs(): Record<string, ProviderConfig> {
  return { ...cachedProviderConfigs };
}

export function getCachedProviderList(): string[] {
  return [...cachedProviderList];
}

export async function saveApiKey(providerId: string, apiKey: string): Promise<{ success: boolean; error?: string }> {
  // Electron environment
  if (typeof window !== 'undefined' && (window as any).electronAPI?.apiKey?.save) {
    return await (window as any).electronAPI.apiKey.save(providerId, apiKey);
  }
  // Browser environment - use browserStorage
  try {
    await browserStorage.set(`apikey:${providerId}`, apiKey);
    return { success: true };
  } catch (error) {
    console.error('[ProviderConfig] Failed to save API key to browser storage:', error);
    return { success: false, error: 'Failed to save API key' };
  }
}

export async function loadApiKey(providerId: string): Promise<{ success: boolean; data: string | null; error?: string }> {
  // Electron environment
  if (typeof window !== 'undefined' && (window as any).electronAPI?.apiKey?.load) {
    return await (window as any).electronAPI.apiKey.load(providerId);
  }
  // Browser environment - use browserStorage
  try {
    const apiKey = await browserStorage.get<string>(`apikey:${providerId}`);
    if (apiKey) {
      return { success: true, data: apiKey };
    }
    return { success: true, data: null };
  } catch (error) {
    console.error('[ProviderConfig] Failed to load API key from browser storage:', error);
    return { success: false, data: null, error: 'Failed to load API key' };
  }
}

export async function deleteApiKey(providerId: string): Promise<{ success: boolean; error?: string }> {
  if (typeof window !== 'undefined' && (window as any).electronAPI?.apiKey?.delete) {
    return await (window as any).electronAPI.apiKey.delete(providerId);
  }
  return { success: false, error: 'API not available' };
}

export async function listApiKeys(): Promise<{ success: boolean; data: string[]; error?: string }> {
  if (typeof window !== 'undefined' && (window as any).electronAPI?.apiKey?.list) {
    return await (window as any).electronAPI.apiKey.list();
  }
  return { success: false, data: [], error: 'API not available' };
}
