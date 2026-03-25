import {
  StratixDataStore,
  TemplateLibrary,
  LogStore,
  BackupManager,
  initializeDataStore
} from '../stratix-data-store';

class DataStoreService {
  private static instance: DataStoreService;
  private dataStore: StratixDataStore | null = null;
  private templateLibrary: TemplateLibrary | null = null;
  private logStore: LogStore | null = null;
  private backupManager: BackupManager | null = null;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): DataStoreService {
    if (!DataStoreService.instance) {
      DataStoreService.instance = new DataStoreService();
    }
    return DataStoreService.instance;
  }

  async initialize(dataDir?: string): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize(dataDir);
    return this.initPromise;
  }

  private async doInitialize(dataDir?: string): Promise<void> {
    const { store, templates, logs, backup } = await initializeDataStore();
    
    this.dataStore = store;
    this.templateLibrary = templates;
    this.logStore = logs;
    this.backupManager = backup;
    this.initialized = true;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.dataStore || !this.templateLibrary || !this.logStore) {
      throw new Error('DataStoreService not initialized. Call initialize() first.');
    }
  }

  getStore(): StratixDataStore {
    this.ensureInitialized();
    return this.dataStore!;
  }

  getTemplateLibrary(): TemplateLibrary {
    this.ensureInitialized();
    return this.templateLibrary!;
  }

  getLogStore(): LogStore {
    this.ensureInitialized();
    return this.logStore!;
  }

  getBackupManager(): BackupManager {
    this.ensureInitialized();
    return this.backupManager!;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async saveChatMessage(msg: {
    messageId: string;
    agentId: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }): Promise<void> {
    this.ensureInitialized();
    return this.dataStore!.saveChatMessage(msg);
  }

  async getChatMessages(
    agentId: string,
    limit = 20,
    offset = 0
  ) {
    this.ensureInitialized();
    return this.dataStore!.getChatMessages(agentId, limit, offset);
  }

  async searchChatMessages(
    agentId: string,
    keywords: string[],
    limit = 10
  ) {
    this.ensureInitialized();
    return this.dataStore!.searchChatMessages(agentId, keywords, limit);
  }

  async deleteChatMessages(agentId: string): Promise<void> {
    this.ensureInitialized();
    return this.dataStore!.deleteChatMessages(agentId);
  }
}

export const dataStoreService = DataStoreService.getInstance();
export default DataStoreService;
