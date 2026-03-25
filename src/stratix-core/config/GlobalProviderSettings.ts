import type { LLMConfig } from '../../stratix-agent/types';

/**
 * Complete provider entry with API key and endpoint configuration
 */
export interface ProviderEntry {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'ollama' | 'deepseek' | 'qwen' | 'custom';
  model: string;
  apiKey?: string; // encrypted in storage
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Provider entry without sensitive data (for display)
 */
export interface ProviderEntrySafe {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  isDefault: boolean;
  hasApiKey: boolean;
  createdAt: number;
  updatedAt: number;
}

// Storage key for non-sensitive config (separate from providerConfig's custom-providers)
const STORAGE_KEY = 'stratix_provider_settings';

/**
 * Global singleton for managing provider configurations.
 * This allows users to configure LLM providers once and use them throughout the app.
 * Uses electronAPI.apiKey for API key storage, and separate JSON for config.
 */
class GlobalProviderSettings {
  private static instance: GlobalProviderSettings;
  private providers: Map<string, ProviderEntry> = new Map();
  private loaded = false;
  private loading: Promise<void> | null = null;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.loading = this.load();
    }
  }

  static getInstance(): GlobalProviderSettings {
    if (!GlobalProviderSettings.instance) {
      GlobalProviderSettings.instance = new GlobalProviderSettings();
    }
    return GlobalProviderSettings.instance;
  }

  /**
   * Check if running in Electron environment
   */
  private isElectron(): boolean {
    return typeof window !== 'undefined' && !!(window as any).electronAPI;
  }

  /**
   * Load providers from Electron (apiKey + config) or browser (localStorage)
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loading) await this.loading;

    try {
      if (this.isElectron()) {
        // Electron: load config from file, API keys from secure storage
        const config = await this.loadElectronConfig();
        if (config) {
          // Load API keys separately via secure API
          for (const entry of config) {
            const apiKeyResult = await (window as any).electronAPI.apiKey.load(entry.id);
            entry.apiKey = apiKeyResult.success ? apiKeyResult.data : undefined;
            this.providers.set(entry.id, entry);
          }
        }
      } else {
        // Browser: load everything from localStorage
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const entries = JSON.parse(stored) as ProviderEntry[];
          entries.forEach(e => this.providers.set(e.id, e));
        }
      }
    } catch (error) {
      console.error('[GlobalProviderSettings] Failed to load providers:', error);
    }

    this.loaded = true;
    this.loading = null;
  }

  /**
   * Load provider configs from electron file storage
   */
  private async loadElectronConfig(): Promise<ProviderEntry[] | null> {
    try {
      const result = await (window as any).electronAPI.config.loadCustomProviders();
      if (result.success && result.data) {
        return JSON.parse(result.data);
      }
    } catch (error) {
      console.error('[GlobalProviderSettings] Failed to load electron config:', error);
    }
    return null;
  }

  /**
   * Ensure providers are loaded before reading
   */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.load();
  }

  /**
   * Save provider config (non-sensitive fields) to electron file or localStorage
   */
  private async saveConfig(entries: ProviderEntry[]): Promise<void> {
    try {
      if (this.isElectron()) {
        await (window as any).electronAPI.config.saveCustomProviders(JSON.stringify(entries, null, 2));
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      }
    } catch (error) {
      console.error('[GlobalProviderSettings] Failed to save config:', error);
    }
  }

  /**
   * Save API key to electron secure storage or localStorage
   */
  private async saveApiKey(providerId: string, apiKey?: string): Promise<void> {
    try {
      if (this.isElectron()) {
        if (apiKey) {
          await (window as any).electronAPI.apiKey.save(providerId, apiKey);
        } else {
          await (window as any).electronAPI.apiKey.delete(providerId);
        }
      } else {
        if (apiKey) {
          localStorage.setItem(`${STORAGE_KEY}:apikey:${providerId}`, apiKey);
        } else {
          localStorage.removeItem(`${STORAGE_KEY}:apikey:${providerId}`);
        }
      }
    } catch (error) {
      console.error('[GlobalProviderSettings] Failed to save API key:', error);
    }
  }

  /**
   * Load API key from electron secure storage or localStorage
   */
  private async loadApiKey(providerId: string): Promise<string | undefined> {
    try {
      if (this.isElectron()) {
        const result = await (window as any).electronAPI.apiKey.load(providerId);
        return result.success ? result.data : undefined;
      } else {
        return localStorage.getItem(`${STORAGE_KEY}:apikey:${providerId}`) || undefined;
      }
    } catch (error) {
      console.error('[GlobalProviderSettings] Failed to load API key:', error);
      return undefined;
    }
  }

  /**
   * Check if a provider name already exists (for duplicate detection)
   */
  hasDuplicateName(name: string, excludeId?: string): boolean {
    return Array.from(this.providers.values()).some(
      p => p.name === name && p.id !== excludeId
    );
  }

  /**
   * Add a new provider configuration
   */
  async addProvider(entry: Omit<ProviderEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const id = `provider_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    // If this is set as default, unset other defaults
    if (entry.isDefault) {
      this.providers.forEach(p => p.isDefault = false);
    }

    const newEntry: ProviderEntry = {
      ...entry,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.providers.set(id, newEntry);

    // Save API key separately
    await this.saveApiKey(id, entry.apiKey);
    // Save config without API key
    await this.saveConfig(Array.from(this.providers.values()).map(p => ({ ...p, apiKey: undefined })));

    return id;
  }

  /**
   * Update an existing provider
   */
  async updateProvider(id: string, updates: Partial<Omit<ProviderEntry, 'id' | 'createdAt' | 'updatedAt'>>): Promise<boolean> {
    const provider = this.providers.get(id);
    if (!provider) return false;

    // If setting as default, unset other defaults
    if (updates.isDefault) {
      this.providers.forEach(p => p.isDefault = false);
    }

    const updatedEntry: ProviderEntry = {
      ...provider,
      ...updates,
      updatedAt: Date.now(),
    };

    this.providers.set(id, updatedEntry);

    // Save API key separately if changed
    if (updates.apiKey !== undefined) {
      await this.saveApiKey(id, updates.apiKey);
    }
    // Save config without API key
    await this.saveConfig(Array.from(this.providers.values()).map(p => ({ ...p, apiKey: undefined })));

    return true;
  }

  /**
   * Get a provider by ID
   */
  getProvider(id: string): ProviderEntry | undefined {
    return this.providers.get(id);
  }

  /**
   * Get all providers (without sensitive API key data)
   */
  getProviders(): ProviderEntry[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get all providers safe for display (no API key)
   */
  getProvidersSafe(): ProviderEntrySafe[] {
    return Array.from(this.providers.values()).map(p => ({
      id: p.id,
      name: p.name,
      provider: p.provider,
      model: p.model,
      baseUrl: p.baseUrl,
      temperature: p.temperature,
      maxTokens: p.maxTokens,
      isDefault: p.isDefault || false,
      hasApiKey: !!p.apiKey,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  /**
   * Get the default provider
   */
  getDefaultProvider(): ProviderEntry | undefined {
    return Array.from(this.providers.values()).find(p => p.isDefault);
  }

  /**
   * Set a provider as the default
   */
  async setDefault(id: string): Promise<boolean> {
    const provider = this.providers.get(id);
    if (!provider) return false;

    // Unset all defaults
    this.providers.forEach(p => p.isDefault = false);

    // Set this one as default
    provider.isDefault = true;
    provider.updatedAt = Date.now();

    await this.saveConfig(Array.from(this.providers.values()).map(p => ({ ...p, apiKey: undefined })));
    return true;
  }

  /**
   * Delete a provider
   */
  async deleteProvider(id: string): Promise<boolean> {
    const provider = this.providers.get(id);
    if (!provider) return false;

    this.providers.delete(id);
    await this.saveApiKey(id, undefined); // Delete stored API key
    await this.saveConfig(Array.from(this.providers.values()).map(p => ({ ...p, apiKey: undefined })));
    return true;
  }

  /**
   * Get provider as LLMConfig for use with LLMConnector
   */
  getLLMConfig(id: string): LLMConfig | undefined {
    const provider = this.providers.get(id);
    if (!provider) return undefined;

    return {
      provider: provider.provider,
      model: provider.model,
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      temperature: provider.temperature,
      maxTokens: provider.maxTokens,
    };
  }

  /**
   * Get the first available provider with API key
   */
  getFirstAvailableProvider(): LLMConfig | undefined {
    const providers = Array.from(this.providers.values());
    const withKey = providers.find(p => p.apiKey);
    return withKey ? this.getLLMConfig(withKey.id) : undefined;
  }

  /**
   * Check if a provider has a valid API key
   */
  hasValidApiKey(id: string): boolean {
    const provider = this.providers.get(id);
    return !!provider?.apiKey;
  }
}

export default GlobalProviderSettings;
