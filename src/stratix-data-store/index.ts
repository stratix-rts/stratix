import path from 'path';

import { BackupManager } from './BackupManager';
import { LogStore } from './LogStore';
import { OpenClawConnectionStore } from './OpenClawConnectionStore';
import { StratixDataStore } from './StratixDataStore';
import { TemplateLibrary } from './TemplateLibrary';

export { StratixDataStore, TemplateLibrary, LogStore, BackupManager, OpenClawConnectionStore };
export * from './types';

export function createDataStore(dataDir?: string): {
  store: StratixDataStore;
  templates: TemplateLibrary;
  logs: LogStore;
  backup: BackupManager;
} {
  const store = new StratixDataStore();
  const templates = new TemplateLibrary(store);
  const logs = new LogStore(store);
  const backup = new BackupManager(store, dataDir ? path.join(dataDir, 'backups') : undefined);
  
  return { store, templates, logs, backup };
}

export async function initializeDataStore(dataDir?: string): Promise<{
  store: StratixDataStore;
  templates: TemplateLibrary;
  logs: LogStore;
  backup: BackupManager;
}> {
  const instance = createDataStore(dataDir);
  await instance.store.initialize(dataDir);
  await instance.templates.initialize();
  return instance;
}
