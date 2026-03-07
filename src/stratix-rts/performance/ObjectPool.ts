export class ObjectPool<T> {
  private pool: T[] = [];
  private createFn: () => T;
  private resetFn: (obj: T) => void;
  private maxSize: number;

  constructor(
    createFn: () => T,
    resetFn: (obj: T) => void,
    maxSize: number = 20
  ) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.maxSize = maxSize;

    for (let i = 0; i < Math.min(5, maxSize); i++) {
      this.pool.push(this.createFn());
    }
  }

  acquire(): T {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }
    return this.createFn();
  }

  release(obj: T): void {
    if (this.pool.length < this.maxSize) {
      this.resetFn(obj);
      this.pool.push(obj);
    }
  }

  getSize(): number {
    return this.pool.length;
  }

  clear(): void {
    this.pool = [];
  }
}

export class ZoneObjectPool {
  private static instance: ZoneObjectPool;
  private graphicsPool: ObjectPool<Phaser.GameObjects.Graphics>;

  private constructor(scene: Phaser.Scene) {
    this.graphicsPool = new ObjectPool(
      () => scene.add.graphics(),
      (graphics) => {
        graphics.clear();
        graphics.setVisible(false);
      },
      20
    );
  }

  static getInstance(scene?: Phaser.Scene): ZoneObjectPool {
    if (!ZoneObjectPool.instance && scene) {
      ZoneObjectPool.instance = new ZoneObjectPool(scene);
    }
    return ZoneObjectPool.instance;
  }

  acquireGraphics(): Phaser.GameObjects.Graphics {
    return this.graphicsPool.acquire();
  }

  releaseGraphics(graphics: Phaser.GameObjects.Graphics): void {
    this.graphicsPool.release(graphics);
  }

  destroy(): void {
    this.graphicsPool.clear();
  }
}