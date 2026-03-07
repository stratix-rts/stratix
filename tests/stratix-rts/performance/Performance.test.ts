import { ObjectPool, ZoneObjectPool } from '@/stratix-rts/performance/ObjectPool';
import { RenderOptimizer } from '@/stratix-rts/performance/RenderOptimizer';

describe('Performance Optimization', () => {
  describe('ObjectPool', () => {
    it('should create pool with initial objects', () => {
      const pool = new ObjectPool(
        () => ({ id: Math.random() }),
        (obj) => { obj.id = 0; },
        10
      );
      
      expect(pool.getSize()).toBe(5);
    });

    it('should acquire object from pool', () => {
      const pool = new ObjectPool(
        () => ({ id: Math.random() }),
        (obj) => { obj.id = 0; },
        10
      );
      
      const obj = pool.acquire();
      expect(obj).toBeDefined();
      expect(pool.getSize()).toBe(4);
    });

    it('should release object back to pool', () => {
      const pool = new ObjectPool(
        () => ({ id: Math.random() }),
        (obj) => { obj.id = 0; },
        10
      );
      
      const obj = pool.acquire();
      pool.release(obj);
      
      expect(pool.getSize()).toBe(5);
    });

    it('should not exceed max size', () => {
      const pool = new ObjectPool(
        () => ({ id: Math.random() }),
        (obj) => { obj.id = 0; },
        3
      );
      
      const obj1 = pool.acquire();
      const obj2 = pool.acquire();
      const obj3 = pool.acquire();
      
      pool.release(obj1);
      pool.release(obj2);
      pool.release(obj3);
      
      expect(pool.getSize()).toBeLessThanOrEqual(3);
    });

    it('should clear pool', () => {
      const pool = new ObjectPool(
        () => ({ id: Math.random() }),
        (obj) => { obj.id = 0; },
        10
      );
      
      pool.clear();
      expect(pool.getSize()).toBe(0);
    });
  });

  describe('RenderOptimizer', () => {
    let optimizer: RenderOptimizer;

    beforeEach(() => {
      optimizer = new RenderOptimizer();
    });

    it('should add dirty regions', () => {
      optimizer.addDirtyRegion(0, 0, 100, 100);
      
      const regions = optimizer.getDirtyRegions();
      expect(regions.length).toBe(1);
      expect(regions[0].x).toBe(0);
      expect(regions[0].y).toBe(0);
    });

    it('should clear dirty regions', () => {
      optimizer.addDirtyRegion(0, 0, 100, 100);
      optimizer.clearDirtyRegions();
      
      expect(optimizer.getDirtyRegions().length).toBe(0);
    });

    it('should queue render', () => {
      optimizer.queueRender('zone-1');
      
      expect(optimizer.needsRender('zone-1')).toBe(true);
    });

    it('should enable/disable optimization', () => {
      optimizer.setEnabled(false);
      expect(optimizer.isEnabled()).toBe(false);
      
      optimizer.setEnabled(true);
      expect(optimizer.isEnabled()).toBe(true);
    });

    it('should set render interval', () => {
      optimizer.setRenderInterval(32);
      
      expect(optimizer.needsRender('zone-1')).toBe(true);
    });
  });
});