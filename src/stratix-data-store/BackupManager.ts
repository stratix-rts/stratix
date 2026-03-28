import { StratixDataStore } from './StratixDataStore';
import fs from 'fs-extra';
import path from 'path';

export interface BackupInfo {
  name: string;
  path: string;
  createdAt: Date;
  size: number;
}

export class BackupManager {
  private dataStore: StratixDataStore;
  private backupDir: string;

  constructor(dataStore: StratixDataStore, backupDir: string = 'stratix-backups') {
    this.dataStore = dataStore;
    this.backupDir = backupDir;
  }

  public async createBackup(): Promise<string> {
    await fs.ensureDir(this.backupDir);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(this.backupDir, `stratix-backup-${timestamp}.json`);
    
    const data = await this.dataStore.exportData();
    await fs.writeFile(backupPath, JSON.stringify(data, null, 2), 'utf-8');
    
    return backupPath;
  }

  public async restoreBackup(backupPath: string): Promise<void> {
    if (!await fs.pathExists(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    
    const data = await fs.readFile(backupPath, 'utf-8');
    await this.dataStore.importData(data);
  }

  public async listBackups(): Promise<BackupInfo[]> {
    await fs.ensureDir(this.backupDir);
    
    const files = await fs.readdir(this.backupDir);
    const backupFiles = files.filter(
      f => f.startsWith('stratix-backup-') && f.endsWith('.json')
    );
    
    const backups: BackupInfo[] = [];
    
    for (const name of backupFiles) {
      const filePath = path.join(this.backupDir, name);
      const stats = await fs.stat(filePath);
      
      backups.push({
        name,
        path: filePath,
        createdAt: stats.birthtime,
        size: stats.size
      });
    }
    
    return backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  public async getLatestBackup(): Promise<BackupInfo | null> {
    const backups = await this.listBackups();
    return backups.length > 0 ? backups[0] : null;
  }

  public async deleteBackup(backupName: string): Promise<boolean> {
    const backupPath = path.join(this.backupDir, backupName);
    
    if (!await fs.pathExists(backupPath)) {
      return false;
    }
    
    await fs.remove(backupPath);
    return true;
  }

  public async cleanOldBackups(keepCount: number = 10): Promise<number> {
    const backups = await this.listBackups();
    
    if (backups.length <= keepCount) {
      return 0;
    }
    
    const toDelete = backups.slice(keepCount);
    let deletedCount = 0;
    
    for (const backup of toDelete) {
      try {
        await fs.remove(backup.path);
        deletedCount++;
      } catch {
        continue;
      }
    }
    
    return deletedCount;
  }

  public getBackupDir(): string {
    return this.backupDir;
  }

  public async getBackupContent(backupName: string): Promise<string> {
    const backupPath = path.join(this.backupDir, backupName);
    
    if (!await fs.pathExists(backupPath)) {
      throw new Error(`Backup file not found: ${backupName}`);
    }
    
    return fs.readFile(backupPath, 'utf-8');
  }
}
