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
}

export const dataStoreService = DataStoreService.getInstance();
export default DataStoreService;
