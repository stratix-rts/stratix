/**
 * BrowserStorage - 浏览器本地存储封装
 * 支持 localStorage 和 IndexedDB
 */

export interface StorageRecord<T> {
  key: string;
  value: T;
  updatedAt: number;
}

class BrowserStorage {
  private db: IDBDatabase | null = null;
  private dbName: string;
  private storeName: string;
  private useIndexedDB: boolean;
  private initPromise: Promise<void> | null = null;

  constructor(dbName: string = 'stratix_browser_storage', storeName: string = 'config') {
    this.useIndexedDB = true;
    this.dbName = dbName;
    this.storeName = storeName;
  }

  async init(): Promise<void> {
    if (!this.useIndexedDB) return;
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.openDatabase();
    return this.initPromise;
  }

  private openDatabase(): Promise<void> {
    return new Promise((resolve, _reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => {
        console.warn('[BrowserStorage] IndexedDB not available, falling back to localStorage');
        this.useIndexedDB = false;
        resolve();
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' });
        }
      };
    });
  }

  private async ensureDb(): Promise<void> {
    if (this.useIndexedDB) {
      await this.init();
    }
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureDb();

    if (!this.useIndexedDB || !this.db) {
      return this.getFromLocalStorage<T>(key);
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as StorageRecord<T> | undefined;
        resolve(record?.value ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.ensureDb();

    if (!this.useIndexedDB || !this.db) {
      return this.setToLocalStorage(key, value);
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const record: StorageRecord<T> = {
        key,
        value,
        updatedAt: Date.now()
      };
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async delete(key: string): Promise<void> {
    await this.ensureDb();

    if (!this.useIndexedDB || !this.db) {
      localStorage.removeItem(key);
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private getFromLocalStorage<T>(key: string): T | null {
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const record = JSON.parse(stored) as StorageRecord<T>;
        return record.value;
      }
    } catch (e) {
      console.error(`[BrowserStorage] Failed to get ${key}:`, e);
    }
    return null;
  }

  private setToLocalStorage<T>(key: string, value: T): void {
    const record: StorageRecord<T> = {
      key,
      value,
      updatedAt: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(record));
  }
}

export const browserStorage = new BrowserStorage();
export default BrowserStorage;
