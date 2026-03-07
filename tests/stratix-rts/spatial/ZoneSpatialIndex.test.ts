import { ZoneSpatialIndex, SpatialZone } from '@/stratix-rts/spatial/ZoneSpatialIndex';

describe('ZoneSpatialIndex', () => {
  let index: ZoneSpatialIndex;

  beforeEach(() => {
    index = new ZoneSpatialIndex(100);
  });

  afterEach(() => {
    index.clear();
  });

  describe('insert and remove', () => {
    it('should insert a zone', () => {
      const zone: SpatialZone = { id: 'zone-1', x: 0, y: 0, width: 100, height: 100 };
      index.insert(zone);

      expect(index.getZone('zone-1')).toEqual(zone);
    });

    it('should remove a zone', () => {
      const zone: SpatialZone = { id: 'zone-1', x: 0, y: 0, width: 100, height: 100 };
      index.insert(zone);
      index.remove('zone-1');

      expect(index.getZone('zone-1')).toBeUndefined();
    });

    it('should update a zone', () => {
      const zone: SpatialZone = { id: 'zone-1', x: 0, y: 0, width: 100, height: 100 };
      index.insert(zone);

      const updatedZone: SpatialZone = { id: 'zone-1', x: 50, y: 50, width: 200, height: 200 };
      index.update(updatedZone);

      expect(index.getZone('zone-1')).toEqual(updatedZone);
    });

    it('should clear all zones', () => {
      const zone1: SpatialZone = { id: 'zone-1', x: 0, y: 0, width: 100, height: 100 };
      const zone2: SpatialZone = { id: 'zone-2', x: 200, y: 200, width: 100, height: 100 };
      
      index.insert(zone1);
      index.insert(zone2);
      index.clear();

      expect(index.getAllZones()).toHaveLength(0);
    });
  });

  describe('queryOverlappingZones', () => {
    it('should find overlapping zones', () => {
      const zone1: SpatialZone = { id: 'zone-1', x: 0, y: 0, width: 100, height: 100 };
      const zone2: SpatialZone = { id: 'zone-2', x: 50, y: 50, width: 100, height: 100 };
      const zone3: SpatialZone = { id: 'zone-3', x: 300, y: 300, width: 100, height: 100 };

      index.insert(zone1);
      index.insert(zone2);
      index.insert(zone3);

      const overlapping = index.queryOverlappingZones(zone1);
      
      expect(overlapping).toHaveLength(1);
      expect(overlapping[0].id).toBe('zone-2');
    });

    it('should not find non-overlapping zones', () => {
      const zone1: SpatialZone = { id: 'zone-1', x: 0, y: 0, width: 100, height: 100 };
      const zone2: SpatialZone = { id: 'zone-2', x: 300, y: 300, width: 100, height: 100 };

      index.insert(zone1);
      index.insert(zone2);

      const overlapping = index.queryOverlappingZones(zone1);
      
      expect(overlapping).toHaveLength(0);
    });

    it('should find multiple overlapping zones', () => {
      const zone1: SpatialZone = { id: 'zone-1', x: 0, y: 0, width: 200, height: 200 };
      const zone2: SpatialZone = { id: 'zone-2', x: 50, y: 50, width: 100, height: 100 };
      const zone3: SpatialZone = { id: 'zone-3', x: 100, y: 100, width: 100, height: 100 };

      index.insert(zone1);
      index.insert(zone2);
      index.insert(zone3);

      const overlapping = index.queryOverlappingZones(zone2);
      
      expect(overlapping).toHaveLength(2);
      expect(overlapping.map(z => z.id).sort()).toEqual(['zone-1', 'zone-3']);
    });

    it('should handle edge-touching zones', () => {
      const zone1: SpatialZone = { id: 'zone-1', x: 0, y: 0, width: 100, height: 100 };
      const zone2: SpatialZone = { id: 'zone-2', x: 100, y: 0, width: 100, height: 100 };

      index.insert(zone1);
      index.insert(zone2);

      const overlapping = index.queryOverlappingZones(zone1);
      
      expect(overlapping).toHaveLength(0);
    });
  });

  describe('queryPoint', () => {
    it('should find zones containing a point', () => {
      const zone1: SpatialZone = { id: 'zone-1', x: 0, y: 0, width: 100, height: 100 };
      const zone2: SpatialZone = { id: 'zone-2', x: 50, y: 50, width: 100, height: 100 };

      index.insert(zone1);
      index.insert(zone2);

      const zones = index.queryPoint(75, 75);
      
      expect(zones).toHaveLength(2);
      expect(zones.map(z => z.id).sort()).toEqual(['zone-1', 'zone-2']);
    });

    it('should return empty array when no zone contains point', () => {
      const zone: SpatialZone = { id: 'zone-1', x: 0, y: 0, width: 100, height: 100 };
      index.insert(zone);

      const zones = index.queryPoint(200, 200);
      
      expect(zones).toHaveLength(0);
    });
  });

  describe('queryRegion', () => {
    it('should find zones overlapping a region', () => {
      const zone1: SpatialZone = { id: 'zone-1', x: 0, y: 0, width: 100, height: 100 };
      const zone2: SpatialZone = { id: 'zone-2', x: 200, y: 200, width: 100, height: 100 };

      index.insert(zone1);
      index.insert(zone2);

      const zones = index.queryRegion(50, 50, 100, 100);
      
      expect(zones).toHaveLength(1);
      expect(zones[0].id).toBe('zone-1');
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', () => {
      const zone1: SpatialZone = { id: 'zone-1', x: 0, y: 0, width: 50, height: 50 };
      const zone2: SpatialZone = { id: 'zone-2', x: 200, y: 200, width: 50, height: 50 };

      index.insert(zone1);
      index.insert(zone2);

      const stats = index.getStatistics();
      
      expect(stats.zoneCount).toBe(2);
      expect(stats.cellCount).toBeGreaterThan(0);
      expect(stats.averageZonesPerCell).toBeGreaterThanOrEqual(1);
    });
  });

  describe('performance', () => {
    it('should handle many zones efficiently', () => {
      const start = Date.now();
      
      for (let i = 0; i < 500; i++) {
        const zone: SpatialZone = {
          id: `zone-${i}`,
          x: (i % 25) * 150,
          y: Math.floor(i / 25) * 150,
          width: 100,
          height: 100
        };
        index.insert(zone);
      }

      const insertTime = Date.now() - start;

      const queryStart = Date.now();
      const testZone: SpatialZone = { id: 'test', x: 500, y: 500, width: 100, height: 100 };
      const overlapping = index.queryOverlappingZones(testZone);
      const queryTime = Date.now() - queryStart;

      expect(insertTime).toBeLessThan(100);
      expect(queryTime).toBeLessThan(5);
    });
  });
});