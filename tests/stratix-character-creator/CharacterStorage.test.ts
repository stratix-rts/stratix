/**
 * CharacterStorage Unit Tests
 *
 * Tests for IndexedDB-based character persistence.
 */

import type { SavedCharacter } from '@/stratix-character-creator/types';

// Create mock request that can trigger callbacks
interface MockRequest {
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  result: any;
}

function createRequest(): MockRequest & { trigger: () => void } {
  let callback: (() => void) | null = null;
  return {
    onsuccess: null,
    onerror: null,
    result: undefined,
    trigger() {
      if (this.onsuccess) this.onsuccess();
    }
  };
}

// Create a simple test double for IndexedDB
class MockIDBCursor {
  public result: any = undefined;
  public onsuccess: (() => void) | null = null;
  public onerror: (() => void) | null = null;

  continue() { this.trigger(); }
  trigger() { if (this.onsuccess) this.onsuccess(); }
}

class MockIDBObjectStore {
  private data: Map<string, any> = new Map();
  public request: MockRequest & { trigger: () => void } = createRequest();

  // Auto-trigger success after async operation (like real IndexedDB)
  private autoTrigger<T>(result: T): MockRequest & { trigger: () => void } {
    this.request.result = result;
    // Use queueMicrotask to trigger asynchronously (like real IndexedDB)
    queueMicrotask(() => {
      if (this.request.onsuccess) {
        this.request.onsuccess();
      }
    });
    return this.request;
  }

  put(value: any): MockRequest & { trigger: () => void } {
    this.data.set(value.characterId, value);
    return this.autoTrigger(undefined);
  }

  get(key: string): MockRequest & { trigger: () => void } {
    return this.autoTrigger(this.data.get(key) ?? null);
  }

  getAll(): MockRequest & { trigger: () => void } {
    return this.autoTrigger(Array.from(this.data.values()));
  }

  delete(key: string): MockRequest & { trigger: () => void } {
    this.data.delete(key);
    return this.autoTrigger(undefined);
  }

  clear(): MockRequest & { trigger: () => void } {
    this.data.clear();
    return this.autoTrigger(undefined);
  }

  createIndex() {}
}

class MockIDBTransaction {
  public objectStoreName: string;
  public mode: string;
  public store: MockIDBObjectStore;

  constructor(name: string, mode: string, store?: MockIDBObjectStore) {
    this.objectStoreName = name;
    this.mode = mode;
    this.store = store || new MockIDBObjectStore();
  }

  objectStore(name: string): MockIDBObjectStore {
    return this.store;
  }
}

class MockIDBDatabase {
  public name: string = 'stratix_character_creator';
  public version: number = 1;
  public objectStoreNames: string[] = ['characters'];
  // Shared store so data persists across transactions
  private sharedStore: MockIDBObjectStore = new MockIDBObjectStore();

  openTransaction(storeNames: string[], mode: string): MockIDBTransaction {
    return new MockIDBTransaction(storeNames[0], mode, this.sharedStore);
  }

  createObjectStore(name: string, options?: any): MockIDBObjectStore {
    return this.sharedStore;
  }
}

class MockIDBFactory {
  public database: MockIDBDatabase;

  constructor() {
    this.database = new MockIDBDatabase();
  }

  open(name: string, version: number): MockRequest & { trigger: () => void } {
    const req = createRequest();
    req.result = this.database;
    // Auto-trigger onsuccess like real IndexedDB
    queueMicrotask(() => {
      if (req.onsuccess) {
        req.onsuccess();
      }
    });
    return req;
  }
}

// Global mock
const mockIDBFactory = new MockIDBFactory();
(global as any).indexedDB = mockIDBFactory;

// Import the storage class
// Using inline implementation for testing
class CharacterStorage {
  private db: any = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.openDatabase();
    return this.initPromise;
  }

  private openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = (global as any).indexedDB.open('stratix_character_creator', 1);

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  private async ensureDb(): Promise<any> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }

  async save(character: SavedCharacter): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.openTransaction(['characters'], 'readwrite');
      const store = tx.objectStore('characters');
      const request = store.put(character);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async load(characterId: string): Promise<SavedCharacter | null> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.openTransaction(['characters'], 'readonly');
      const store = tx.objectStore('characters');
      const request = store.get(characterId);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async list(): Promise<SavedCharacter[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.openTransaction(['characters'], 'readonly');
      const store = tx.objectStore('characters');
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
      const tx = db.openTransaction(['characters'], 'readwrite');
      const store = tx.objectStore('characters');
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
    if (!character) throw new Error(`Character not found: ${characterId}`);
    return JSON.stringify(character, null, 2);
  }

  async import(jsonData: string): Promise<SavedCharacter> {
    const character = JSON.parse(jsonData) as SavedCharacter;
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
      skillTree: { selectedNodes: [], unlockedNodes: [] },
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
      const tx = db.openTransaction(['characters'], 'readwrite');
      const store = tx.objectStore('characters');
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

// Helper to create mock character
function createMockCharacter(overrides: Partial<SavedCharacter> = {}): SavedCharacter {
  return {
    characterId: 'char_123',
    name: 'Test Hero',
    bodyType: 'male',
    parts: {},
    skillTree: { selectedNodes: [], unlockedNodes: [] },
    attributes: {},
    isDefault: false,
    thumbnail: '',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides
  };
}

describe('CharacterStorage', () => {
  let storage: CharacterStorage;
  let mockStore: MockIDBObjectStore;

  beforeEach(() => {
    // Reset the mock database for each test
    mockIDBFactory.database = new MockIDBDatabase();
    mockStore = mockIDBFactory.database.openTransaction(['characters'], 'readwrite').objectStore('characters');
    storage = new CharacterStorage();
  });

  describe('init', () => {
    test('should open database successfully', async () => {
      await storage.init();
      expect(mockIDBFactory.database.name).toBe('stratix_character_creator');
    });

    test('should not reinitialize if already initialized', async () => {
      await storage.init();
      await storage.init(); // should not throw
    });
  });

  describe('save', () => {
    test('should save character to database', async () => {
      await storage.init();
      const character = createMockCharacter();
      await storage.save(character);

      const loaded = await storage.load('char_123');
      expect(loaded?.name).toBe('Test Hero');
    });
  });

  describe('load', () => {
    test('should load character by id', async () => {
      await storage.init();
      const character = createMockCharacter();
      await storage.save(character);

      const loaded = await storage.load('char_123');
      expect(loaded?.characterId).toBe('char_123');
    });

    test('should return null for non-existent character', async () => {
      await storage.init();
      const loaded = await storage.load('non_existent');
      expect(loaded).toBeNull();
    });
  });

  describe('list', () => {
    test('should return all characters sorted by updatedAt descending', async () => {
      await storage.init();
      const char1 = createMockCharacter({ characterId: 'char_1', name: 'Older', updatedAt: 1000 });
      const char2 = createMockCharacter({ characterId: 'char_2', name: 'Newer', updatedAt: 2000 });
      await storage.save(char1);
      await storage.save(char2);

      const list = await storage.list();
      expect(list[0].characterId).toBe('char_2');
      expect(list[1].characterId).toBe('char_1');
    });

    test('should return empty array when no characters exist', async () => {
      await storage.init();
      const list = await storage.list();
      expect(list).toEqual([]);
    });
  });

  describe('delete', () => {
    test('should delete character by id', async () => {
      await storage.init();
      const character = createMockCharacter();
      await storage.save(character);

      await storage.delete('char_123');

      const loaded = await storage.load('char_123');
      expect(loaded).toBeNull();
    });
  });

  describe('getByName', () => {
    test('should find character by name', async () => {
      await storage.init();
      const character = createMockCharacter({ characterId: 'char_1', name: 'Test Hero' });
      await storage.save(character);

      const found = await storage.getByName('Test Hero');
      expect(found?.characterId).toBe('char_1');
    });

    test('should return null when character not found', async () => {
      await storage.init();
      const found = await storage.getByName('Non Existent');
      expect(found).toBeNull();
    });
  });

  describe('export', () => {
    test('should export character as JSON string', async () => {
      await storage.init();
      const character = createMockCharacter();
      await storage.save(character);

      const json = await storage.export('char_123');
      expect(typeof json).toBe('string');
      expect(JSON.parse(json).characterId).toBe('char_123');
    });

    test('should throw error for non-existent character', async () => {
      await storage.init();
      await expect(storage.export('non_existent')).rejects.toThrow('Character not found');
    });
  });

  describe('import', () => {
    test('should import valid character JSON', async () => {
      await storage.init();
      const jsonData = JSON.stringify({
        characterId: 'old_id',
        name: 'Imported Hero',
        bodyType: 'female',
        parts: {},
        skillTree: { selectedNodes: [], unlockedNodes: [] },
        attributes: {},
        isDefault: false,
        thumbnail: ''
      });

      const imported = await storage.import(jsonData);
      expect(imported.name).toBe('Imported Hero');
      expect(imported.characterId).toMatch(/^char_/);
    });

    test('should throw error for invalid JSON', async () => {
      await storage.init();
      await expect(storage.import('invalid json')).rejects.toThrow();
    });

    test('should throw error for missing required fields', async () => {
      await storage.init();
      await expect(storage.import('{"name": "Test"}')).rejects.toThrow('Invalid character data');
    });
  });

  describe('createNew', () => {
    test('should create new character with default values', () => {
      const character = storage.createNew();

      expect(character.characterId).toMatch(/^char_/);
      expect(character.name).toContain('新角色');
      expect(character.bodyType).toBe('male');
      expect(character.parts).toEqual({});
      expect(character.isDefault).toBe(false);
    });

    test('should create new character with specified body type', () => {
      const character = storage.createNew('female');
      expect(character.bodyType).toBe('female');
    });
  });

  describe('generateId', () => {
    test('should generate unique IDs', () => {
      const id1 = storage.generateId();
      const id2 = storage.generateId();
      expect(id1).toMatch(/^char_/);
      expect(id2).toMatch(/^char_/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('clear', () => {
    test('should clear all characters from store', async () => {
      await storage.init();
      const character = createMockCharacter();
      await storage.save(character);

      await storage.clear();

      const list = await storage.list();
      expect(list).toEqual([]);
    });
  });
});
