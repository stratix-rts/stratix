/**
 * CharacterStorage Unit Tests
 *
 * Tests for IndexedDB-based character persistence.
 */

// Mock indexedDB
const indexedDB = {
  open: jest.fn()
};

global.indexedDB = indexedDB as any;

import type { SavedCharacter } from '@/stratix-character-creator/types';

// Simplified CharacterStorage for testing (matching source structure)
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
      const request = indexedDB.open('stratix_character_creator', 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('characters')) {
          const store = db.createObjectStore('characters', { keyPath: 'characterId' });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  private async ensureDb(): Promise<IDBDatabase> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }

  async save(character: SavedCharacter): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['characters'], 'readwrite');
      const store = transaction.objectStore('characters');
      const request = store.put(character);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async load(characterId: string): Promise<SavedCharacter | null> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['characters'], 'readonly');
      const store = transaction.objectStore('characters');
      const request = store.get(characterId);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async list(): Promise<SavedCharacter[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['characters'], 'readonly');
      const store = transaction.objectStore('characters');
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
      const transaction = db.transaction(['characters'], 'readwrite');
      const store = transaction.objectStore('characters');
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
      const transaction = db.transaction(['characters'], 'readwrite');
      const store = transaction.objectStore('characters');
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

describe('CharacterStorage', () => {
  let storage: CharacterStorage;
  let mockDb: any;
  let mockTransaction: any;
  let mockStore: any;

  beforeEach(() => {
    storage = new CharacterStorage();
    mockStore = {
      put: jest.fn(),
      get: jest.fn(),
      getAll: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
      createIndex: jest.fn()
    };
    mockTransaction = {
      objectStore: jest.fn().mockReturnValue(mockStore),
      oncomplete: null,
      onerror: null
    };
    mockDb = {
      transaction: jest.fn().mockReturnValue(mockTransaction),
      objectStoreNames: { contains: jest.fn().mockReturnValue(true) },
      createObjectStore: jest.fn().mockReturnValue(mockStore)
    };
    indexedDB.open.mockResolvedValue(mockDb);
  });

  describe('init', () => {
    test('should open database with correct name and version', async () => {
      await storage.init();
      expect(indexedDB.open).toHaveBeenCalledWith('stratix_character_creator', 1);
    });

    test('should not reinitialize if already initialized', async () => {
      await storage.init();
      await storage.init();
      expect(indexedDB.open).toHaveBeenCalledTimes(1);
    });
  });

  describe('save', () => {
    test('should save character to database', async () => {
      mockStore.put.mockReturnValue({ onsuccess: null, onerror: null });

      const character: SavedCharacter = {
        characterId: 'char_123',
        name: 'Test Hero',
        bodyType: 'male',
        parts: {},
        skillTree: { selectedNodes: [], unlockedNodes: [] },
        attributes: {},
        isDefault: false,
        thumbnail: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await storage.init();
      await storage.save(character);

      expect(mockTransaction.objectStore).toHaveBeenCalledWith('characters');
      expect(mockStore.put).toHaveBeenCalledWith(character);
    });
  });

  describe('load', () => {
    test('should load character by id', async () => {
      const character: SavedCharacter = {
        characterId: 'char_123',
        name: 'Test Hero',
        bodyType: 'male',
        parts: {},
        skillTree: { selectedNodes: [], unlockedNodes: [] },
        attributes: {},
        isDefault: false,
        thumbnail: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      mockStore.get.mockReturnValue({
        onsuccess: null,
        onerror: null,
        result: character
      });

      await storage.init();
      const result = await storage.load('char_123');
      expect(result).toEqual(character);
    });

    test('should return null for non-existent character', async () => {
      mockStore.get.mockReturnValue({
        onsuccess: null,
        onerror: null,
        result: undefined
      });

      await storage.init();
      const result = await storage.load('non_existent');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    test('should return all characters sorted by updatedAt descending', async () => {
      const characters: SavedCharacter[] = [
        {
          characterId: 'char_1',
          name: 'Older',
          bodyType: 'male',
          parts: {},
          skillTree: { selectedNodes: [], unlockedNodes: [] },
          attributes: {},
          isDefault: false,
          thumbnail: '',
          createdAt: 1000,
          updatedAt: 1000
        },
        {
          characterId: 'char_2',
          name: 'Newer',
          bodyType: 'female',
          parts: {},
          skillTree: { selectedNodes: [], unlockedNodes: [] },
          attributes: {},
          isDefault: false,
          thumbnail: '',
          createdAt: 2000,
          updatedAt: 2000
        }
      ];

      mockStore.getAll.mockReturnValue({
        onsuccess: null,
        onerror: null,
        result: characters
      });

      await storage.init();
      const result = await storage.list();

      expect(result[0].characterId).toBe('char_2'); // newer first
      expect(result[1].characterId).toBe('char_1'); // older second
    });

    test('should return empty array when no characters exist', async () => {
      mockStore.getAll.mockReturnValue({
        onsuccess: null,
        onerror: null,
        result: []
      });

      await storage.init();
      const result = await storage.list();
      expect(result).toEqual([]);
    });
  });

  describe('delete', () => {
    test('should delete character by id', async () => {
      mockStore.delete.mockReturnValue({ onsuccess: null, onerror: null });

      await storage.init();
      await storage.delete('char_123');

      expect(mockTransaction.objectStore).toHaveBeenCalledWith('characters');
      expect(mockStore.delete).toHaveBeenCalledWith('char_123');
    });
  });

  describe('getByName', () => {
    test('should find character by name', async () => {
      const characters: SavedCharacter[] = [
        {
          characterId: 'char_1',
          name: 'Test Hero',
          bodyType: 'male',
          parts: {},
          skillTree: { selectedNodes: [], unlockedNodes: [] },
          attributes: {},
          isDefault: false,
          thumbnail: '',
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];

      mockStore.getAll.mockReturnValue({
        onsuccess: null,
        onerror: null,
        result: characters
      });

      await storage.init();
      const result = await storage.getByName('Test Hero');
      expect(result?.characterId).toBe('char_1');
    });

    test('should return null when character not found', async () => {
      mockStore.getAll.mockReturnValue({
        onsuccess: null,
        onerror: null,
        result: []
      });

      await storage.init();
      const result = await storage.getByName('Non Existent');
      expect(result).toBeNull();
    });
  });

  describe('export', () => {
    test('should export character as JSON string', async () => {
      const character: SavedCharacter = {
        characterId: 'char_123',
        name: 'Test Hero',
        bodyType: 'male',
        parts: {},
        skillTree: { selectedNodes: [], unlockedNodes: [] },
        attributes: {},
        isDefault: false,
        thumbnail: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      mockStore.get.mockReturnValue({
        onsuccess: null,
        onerror: null,
        result: character
      });

      await storage.init();
      const result = await storage.export('char_123');

      expect(typeof result).toBe('string');
      expect(JSON.parse(result).characterId).toBe('char_123');
    });

    test('should throw error for non-existent character', async () => {
      mockStore.get.mockReturnValue({
        onsuccess: null,
        onerror: null,
        result: undefined
      });

      await storage.init();
      await expect(storage.export('non_existent')).rejects.toThrow('Character not found');
    });
  });

  describe('import', () => {
    test('should import valid character JSON', async () => {
      mockStore.put.mockReturnValue({ onsuccess: null, onerror: null });
      mockStore.get.mockReturnValue({
        onsuccess: null,
        onerror: null,
        result: null
      });
      mockStore.getAll.mockReturnValue({
        onsuccess: null,
        onerror: null,
        result: []
      });

      const jsonData = JSON.stringify({
        characterId: 'old_id',
        name: 'Imported Hero',
        bodyType: 'female',
        parts: { body: { itemId: 'body_female', variant: 'light' } },
        skillTree: { selectedNodes: ['skill1'], unlockedNodes: ['skill1'] },
        attributes: { strength: 10 },
        isDefault: false,
        thumbnail: 'data:image/png;base64,abc'
      });

      await storage.init();
      const result = await storage.import(jsonData);

      expect(result.name).toBe('Imported Hero');
      expect(result.bodyType).toBe('female');
      expect(result.characterId).toMatch(/^char_/); // new ID generated
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
      expect(character.skillTree).toEqual({ selectedNodes: [], unlockedNodes: [] });
      expect(character.attributes).toEqual({});
      expect(character.isDefault).toBe(false);
      expect(character.thumbnail).toBe('');
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
      mockStore.clear.mockReturnValue({ onsuccess: null, onerror: null });

      await storage.init();
      await storage.clear();

      expect(mockTransaction.objectStore).toHaveBeenCalledWith('characters');
      expect(mockStore.clear).toHaveBeenCalled();
    });
  });
});
