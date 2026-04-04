/**
 * CharacterStorage - 角色持久化存储
 * 使用 IndexedDB 存储角色配置
 */

import { DB_NAME, DB_VERSION, STORE_NAME, STORAGE_KEY } from '../constants';
import type { SavedCharacter } from '../types';

class CharacterStorage {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.openDatabase();
    return this.initPromise;
  }

  private openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'characterId' });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  private async ensureDb(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.init();
    }
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  async save(character: SavedCharacter): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(character);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async load(characterId: string): Promise<SavedCharacter | null> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(characterId);

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async list(): Promise<SavedCharacter[]> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result as SavedCharacter[];
        results.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async delete(characterId: string): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(characterId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getByName(name: string): Promise<SavedCharacter | null> {
    const characters = await this.list();
    return characters.find(c => c.name === name) ?? null;
  }

  async export(characterId: string): Promise<string> {
    const character = await this.load(characterId);
    if (!character) {
      throw new Error(`Character not found: ${characterId}`);
    }
    return JSON.stringify(character, null, 2);
  }

  async import(jsonData: string): Promise<SavedCharacter> {
    let character: SavedCharacter;
    try {
      character = JSON.parse(jsonData) as SavedCharacter;
    } catch {
      throw new Error('Invalid JSON format');
    }

    if (!character.characterId || !character.name || !character.bodyType) {
      throw new Error('Invalid character data');
    }

    character.characterId = this.generateId();
    character.createdAt = Date.now();
    character.updatedAt = Date.now();

    await this.save(character);
    return character;
  }

  generateId(): string {
    return `char_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  createNew(bodyType: string = 'male'): SavedCharacter {
    return {
      characterId: this.generateId(),
      name: `新角色 ${Date.now().toString(36).slice(-4)}`,
      bodyType: bodyType as SavedCharacter['bodyType'],
      parts: {},
      skillTree: {
        selectedNodes: [],
        unlockedNodes: []
      },
      attributes: {},
      isDefault: false,
      thumbnail: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  async clear(): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export const characterStorage = new CharacterStorage();
export default CharacterStorage;
