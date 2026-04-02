import * as path from 'path';

import * as fs from 'fs-extra';

import {
  OpenClawConnectionRecord,
  OpenClawConnectionsConfig,
  DEFAULT_OPENCLAW_CONFIG,
  ConnectionPoolStatus,
} from './types';

const CONFIG_FILENAME = 'openclaw-connections.json';

type ConfigChangeListener = (config: OpenClawConnectionsConfig) => void;

export class OpenClawConnectionStore {
  private configPath: string;
  private config: OpenClawConnectionsConfig;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private watcher: fs.FSWatcher | null = null;
  private listeners: Set<ConfigChangeListener> = new Set();

  constructor(dataDir: string = 'stratix-data') {
    this.configPath = path.join(dataDir, CONFIG_FILENAME);
    this.config = { ...DEFAULT_OPENCLAW_CONFIG };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    await fs.ensureDir(path.dirname(this.configPath));

    try {
      const exists = await fs.pathExists(this.configPath);
      if (exists) {
        const content = await fs.readFile(this.configPath, 'utf-8');
        const parsed = JSON.parse(content);
        this.config = this.mergeWithDefaults(parsed);
        this.upgradeConfig(this.config);
      } else {
        this.config = { ...DEFAULT_OPENCLAW_CONFIG };
        this.config.metadata.createdAt = Date.now();
        await this.persist();
      }
    } catch (error) {
      console.warn('[OpenClawConnectionStore] Failed to load config, using defaults:', error);
      this.config = { ...DEFAULT_OPENCLAW_CONFIG };
    }

    this.initialized = true;
  }

  private mergeWithDefaults(parsed: Partial<OpenClawConnectionsConfig>): OpenClawConnectionsConfig {
    return {
      version: parsed.version || DEFAULT_OPENCLAW_CONFIG.version,
      connections: Array.isArray(parsed.connections) ? parsed.connections : [],
      metadata: {
        createdAt: parsed.metadata?.createdAt || Date.now(),
        updatedAt: parsed.metadata?.updatedAt || Date.now(),
      },
    };
  }

  private upgradeConfig(config: OpenClawConnectionsConfig): void {
    for (const conn of config.connections) {
      if (!conn.id) {
        conn.id = this.generateId();
      }
      if (!conn.createdAt) {
        conn.createdAt = Date.now();
      }
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async persist(): Promise<void> {
    this.config.metadata.updatedAt = Date.now();
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  private generateId(): string {
    return 'conn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  async list(): Promise<OpenClawConnectionRecord[]> {
    await this.ensureInitialized();
    return [...this.config.connections];
  }

  async get(id: string): Promise<OpenClawConnectionRecord | null> {
    await this.ensureInitialized();
    return this.config.connections.find(c => c.id === id) || null;
  }

  async findByEndpoint(endpoint: string): Promise<OpenClawConnectionRecord | null> {
    await this.ensureInitialized();
    return this.config.connections.find(c => c.endpoint === endpoint) || null;
  }

  async checkEndpointExists(endpoint: string): Promise<{ exists: boolean; connection?: OpenClawConnectionRecord }> {
    await this.ensureInitialized();
    const existing = this.config.connections.find(c => c.endpoint === endpoint);
    if (existing) {
      return { exists: true, connection: existing };
    }
    return { exists: false };
  }

  async create(record: Omit<OpenClawConnectionRecord, 'id' | 'createdAt'> & { id?: string }): Promise<OpenClawConnectionRecord> {
    await this.ensureInitialized();

    const newRecord: OpenClawConnectionRecord = {
      ...record,
      id: record.id || this.generateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.config.connections.push(newRecord);
    await this.persist();

    return newRecord;
  }

  async update(id: string, updates: Partial<OpenClawConnectionRecord>): Promise<OpenClawConnectionRecord | null> {
    await this.ensureInitialized();

    const index = this.config.connections.findIndex(c => c.id === id);
    if (index < 0) return null;

    this.config.connections[index] = {
      ...this.config.connections[index],
      ...updates,
      updatedAt: Date.now(),
    };

    await this.persist();
    return this.config.connections[index];
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureInitialized();

    const initialLength = this.config.connections.length;
    this.config.connections = this.config.connections.filter(c => c.id !== id);

    if (this.config.connections.length < initialLength) {
      await this.persist();
      return true;
    }
    return false;
  }

  async updateDeviceToken(id: string, deviceToken: string): Promise<void> {
    await this.update(id, { deviceToken });
  }

  startWatching(): void {
    if (this.watcher) return;

    try {
      this.watcher = fs.watch(this.configPath, (eventType) => {
        if (eventType === 'change') {
          this.reload();
        }
      });
      console.log('[OpenClawConnectionStore] Started watching config file');
    } catch (error) {
      console.warn('[OpenClawConnectionStore] Failed to start watcher:', error);
    }
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private async reload(): Promise<void> {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(content);
      this.config = this.mergeWithDefaults(parsed);
      this.upgradeConfig(this.config);
      this.notifyListeners();
      console.log('[OpenClawConnectionStore] Config reloaded');
    } catch (error) {
      console.warn('[OpenClawConnectionStore] Failed to reload config:', error);
    }
  }

  addListener(listener: ConfigChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.config);
      } catch (error) {
        console.error('[OpenClawConnectionStore] Listener error:', error);
      }
    });
  }

  getConfigPath(): string {
    return this.configPath;
  }

  getConfig(): OpenClawConnectionsConfig {
    return this.config;
  }
}

export default OpenClawConnectionStore;