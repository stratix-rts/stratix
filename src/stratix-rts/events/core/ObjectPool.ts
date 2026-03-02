export interface Poolable {
  reset(): void;
}

type Factory<T> = () => T;

interface PoolEntry<T> {
  obj: T;
  inUse: boolean;
}

export class ObjectPool<T extends Poolable = Poolable> {
  private pool: PoolEntry<T>[] = [];
  private factory: Factory<T>;
  private maxSize: number;
  private autoExpand: boolean;

  constructor(factory: Factory<T>, options?: { maxSize?: number; autoExpand?: boolean }) {
    this.factory = factory;
    this.maxSize = options?.maxSize ?? 100;
    this.autoExpand = options?.autoExpand ?? true;
  }

  acquire(): T {
    const available = this.pool.find((e) => !e.inUse);
    
    if (available) {
      available.inUse = true;
      return available.obj;
    }

    if (this.pool.length < this.maxSize || this.autoExpand) {
      const obj = this.factory();
      const entry: PoolEntry<T> = { obj, inUse: true };
      this.pool.push(entry);
      return obj;
    }

    throw new Error(`[ObjectPool] Pool exhausted (max: ${this.maxSize})`);
  }

  release(obj: T): void {
    const entry = this.pool.find((e) => e.obj === obj);
    if (entry) {
      entry.inUse = false;
      obj.reset();
    }
  }

  releaseAll(): void {
    this.pool.forEach((entry) => {
      entry.inUse = false;
      entry.obj.reset();
    });
  }

  get stats() {
    return {
      total: this.pool.length,
      inUse: this.pool.filter((e) => e.inUse).length,
      available: this.pool.filter((e) => !e.inUse).length,
    };
  }

  clear(): void {
    this.pool = [];
  }
}

export class SimpleObjectPool<T> {
  private pool: T[] = [];
  private factory: Factory<T>;
  private resetFn?: (obj: T) => void;

  constructor(
    factory: Factory<T>,
    resetFn?: (obj: T) => void,
    options?: { maxSize?: number; preallocate?: number }
  ) {
    this.factory = factory;
    this.resetFn = resetFn;
    
    const preallocate = options?.preallocate ?? 0;
    for (let i = 0; i < preallocate; i++) {
      this.pool.push(this.factory());
    }
  }

  acquire(): T {
    return this.pool.pop() ?? this.factory();
  }

  release(obj: T): void {
    this.resetFn?.(obj);
    this.pool.push(obj);
  }

  clear(): void {
    this.pool = [];
  }
}
