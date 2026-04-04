interface CacheEntry {
  value: any;
  timestamp: number;
  accessCount: number;
}

export class SharedMemoryCache {
  private cache: Map<string, CacheEntry> = new Map();
  private agentAccessCount: Map<string, Map<string, number>> = new Map();

  constructor(
    private maxSize: number = 1000,
    private ttl: number = 5 * 60 * 1000
  ) {}

  getFromCache(key: string): any {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    entry.accessCount++;
    return entry.value;
  }

  set(key: string, value: any): void {
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 0
    });
  }

  shareMemory(agentId: string, memoryKey: string): void {
    const key = `shared:${memoryKey}`;
    const value = this.cache.get(key);
    if (value) {
      this.agentAccessCount.set(agentId, this.agentAccessCount.get(agentId) || new Map());
      this.agentAccessCount.get(agentId)!.set(key, 0);
    }
  }

  private trackAccess(agentId: string, key: string): void {
    if (!this.agentAccessCount.has(agentId)) {
      this.agentAccessCount.set(agentId, new Map());
    }
    const counts = this.agentAccessCount.get(agentId)!;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  private evictLRU(): void {
    let minScore = Infinity;
    let evictKey: string | null = null;

    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      const score = entry.accessCount / (Date.now() - entry.timestamp);
      if (score < minScore) {
        minScore = score;
        evictKey = key;
      }
    }

    if (evictKey) this.cache.delete(evictKey);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
