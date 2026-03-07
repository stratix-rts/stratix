import { ZoneConnectionManager } from '@/stratix-rts/zones/ZoneConnectionManager';
import { ZoneConnection, type ConnectionType } from '@/stratix-rts/zones/ZoneConnection';

describe('ZoneConnectionManager', () => {
  let manager: ZoneConnectionManager;

  beforeEach(() => {
    manager = new ZoneConnectionManager();
  });

  afterEach(() => {
    manager.clear();
  });

  describe('createConnection', () => {
    it('should create a connection between two zones', () => {
      const connection = manager.createConnection('zone-1', 'zone-2', 'sequential');
      
      expect(connection).toBeDefined();
      expect(connection?.sourceZoneId).toBe('zone-1');
      expect(connection?.targetZoneId).toBe('zone-2');
      expect(connection?.type).toBe('sequential');
    });

    it('should return null for invalid connection', () => {
      const connection = manager.createConnection('zone-1', 'zone-1', 'sequential');
      
      expect(connection).toBeNull();
    });

    it('should store the connection', () => {
      manager.createConnection('zone-1', 'zone-2', 'parallel');
      
      const connections = manager.getAllConnections();
      expect(connections.length).toBe(1);
    });
  });

  describe('deleteConnection', () => {
    it('should delete an existing connection', () => {
      const connection = manager.createConnection('zone-1', 'zone-2');
      expect(connection).toBeDefined();
      
      const result = manager.deleteConnection(connection!.id);
      expect(result).toBe(true);
      
      const connections = manager.getAllConnections();
      expect(connections.length).toBe(0);
    });

    it('should return false for non-existent connection', () => {
      const result = manager.deleteConnection('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('getConnection', () => {
    it('should return the connection by id', () => {
      const created = manager.createConnection('zone-1', 'zone-2');
      
      const retrieved = manager.getConnection(created!.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created!.id);
    });

    it('should return undefined for non-existent connection', () => {
      const result = manager.getConnection('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('getConnectionsByZone', () => {
    it('should return all connections for a zone', () => {
      manager.createConnection('zone-1', 'zone-2');
      manager.createConnection('zone-2', 'zone-3');
      manager.createConnection('zone-1', 'zone-3');
      
      const zone1Connections = manager.getConnectionsByZone('zone-1');
      expect(zone1Connections.length).toBe(2);
      
      const zone2Connections = manager.getConnectionsByZone('zone-2');
      expect(zone2Connections.length).toBe(2);
    });

    it('should return empty array for zone with no connections', () => {
      const connections = manager.getConnectionsByZone('zone-without-connections');
      expect(connections).toEqual([]);
    });
  });

  describe('getOutgoingConnections', () => {
    it('should return only outgoing connections', () => {
      manager.createConnection('zone-1', 'zone-2');
      manager.createConnection('zone-2', 'zone-3');
      manager.createConnection('zone-3', 'zone-1');
      
      const outgoing = manager.getOutgoingConnections('zone-1');
      expect(outgoing.length).toBe(1);
      expect(outgoing[0].targetZoneId).toBe('zone-2');
    });
  });

  describe('getIncomingConnections', () => {
    it('should return only incoming connections', () => {
      manager.createConnection('zone-1', 'zone-2');
      manager.createConnection('zone-3', 'zone-2');
      manager.createConnection('zone-2', 'zone-1');
      
      const incoming = manager.getIncomingConnections('zone-2');
      expect(incoming.length).toBe(2);
      expect(incoming.every(c => c.targetZoneId === 'zone-2')).toBe(true);
    });
  });

  describe('updateConnection', () => {
    it('should update connection type', () => {
      const connection = manager.createConnection('zone-1', 'zone-2', 'sequential');
      
      manager.updateConnection(connection!.id, { type: 'parallel' });
      
      const updated = manager.getConnection(connection!.id);
      expect(updated?.type).toBe('parallel');
    });

    it('should update connection metadata', () => {
      const connection = manager.createConnection('zone-1', 'zone-2');
      
      manager.updateConnection(connection!.id, { 
        metadata: { label: 'Test Connection', priority: 1 } 
      });
      
      const updated = manager.getConnection(connection!.id);
      expect(updated?.metadata.label).toBe('Test Connection');
      expect(updated?.metadata.priority).toBe(1);
    });
  });

  describe('validateConnection', () => {
    it('should validate a valid connection', () => {
      const result = manager.validateConnection('zone-1', 'zone-2', 'sequential');
      
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject self-connection when not allowed', () => {
      const noSelfConnManager = new ZoneConnectionManager({ allowSelfConnections: false });
      
      const result = noSelfConnManager.validateConnection('zone-1', 'zone-1', 'sequential');
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Self connections are not allowed');
    });

    it('should allow self-connection when configured', () => {
      const selfConnManager = new ZoneConnectionManager({ allowSelfConnections: true });
      
      const result = selfConnManager.validateConnection('zone-1', 'zone-1', 'sequential');
      
      expect(result.valid).toBe(true);
    });
  });

  describe('wouldCreateCycle', () => {
    it('should detect a cycle', () => {
      manager.createConnection('zone-1', 'zone-2');
      manager.createConnection('zone-2', 'zone-3');
      
      const hasCycle = manager.wouldCreateCycle('zone-3', 'zone-1');
      
      expect(hasCycle).toBe(true);
    });

    it('should not detect a cycle for linear connections', () => {
      manager.createConnection('zone-1', 'zone-2');
      manager.createConnection('zone-2', 'zone-3');
      
      const hasCycle = manager.wouldCreateCycle('zone-1', 'zone-3');
      
      expect(hasCycle).toBe(false);
    });
  });

  describe('getGraph', () => {
    it('should build a connection graph', () => {
      manager.createConnection('zone-1', 'zone-2');
      manager.createConnection('zone-2', 'zone-3');
      
      const graph = manager.getGraph();
      
      expect(graph.nodes.length).toBe(3);
      expect(graph.edges.length).toBe(2);
      expect(graph.adjacencyList.size).toBe(2);
    });
  });

  describe('findPath', () => {
    it('should find a path between two zones', () => {
      manager.createConnection('zone-1', 'zone-2');
      manager.createConnection('zone-2', 'zone-3');
      manager.createConnection('zone-3', 'zone-4');
      
      const path = manager.findPath('zone-1', 'zone-4');
      
      expect(path).toEqual(['zone-1', 'zone-2', 'zone-3', 'zone-4']);
    });

    it('should return null when no path exists', () => {
      manager.createConnection('zone-1', 'zone-2');
      manager.createConnection('zone-3', 'zone-4');
      
      const path = manager.findPath('zone-1', 'zone-4');
      
      expect(path).toBeNull();
    });

    it('should return single element for same zone', () => {
      const path = manager.findPath('zone-1', 'zone-1');
      
      expect(path).toEqual(['zone-1']);
    });
  });

  describe('clearConnectionsForZone', () => {
    it('should clear all connections for a zone', () => {
      manager.createConnection('zone-1', 'zone-2');
      manager.createConnection('zone-2', 'zone-3');
      manager.createConnection('zone-1', 'zone-3');
      
      const count = manager.clearConnectionsForZone('zone-1');
      
      expect(count).toBe(2);
      expect(manager.getConnectionsByZone('zone-1').length).toBe(0);
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize connections', () => {
      manager.createConnection('zone-1', 'zone-2', 'sequential', { label: 'Test' });
      manager.createConnection('zone-2', 'zone-3', 'parallel', { priority: 1 });
      
      const data = manager.serialize();
      
      const newManager = new ZoneConnectionManager();
      newManager.deserialize(data);
      
      const connections = newManager.getAllConnections();
      expect(connections.length).toBe(2);
      
      const conn1 = newManager.getConnection(connections[0].id);
      expect(conn1?.metadata.label).toBe('Test');
    });
  });
});

describe('ZoneConnection', () => {
  it('should create a connection with default values', () => {
    const connection = new ZoneConnection('conn-1', 'zone-1', 'zone-2');
    
    expect(connection.id).toBe('conn-1');
    expect(connection.sourceZoneId).toBe('zone-1');
    expect(connection.targetZoneId).toBe('zone-2');
    expect(connection.type).toBe('sequential');
    expect(connection.metadata).toEqual({});
  });

  it('should update type', () => {
    const connection = new ZoneConnection('conn-1', 'zone-1', 'zone-2', 'sequential');
    
    connection.setType('parallel');
    
    expect(connection.type).toBe('parallel');
  });

  it('should update metadata', () => {
    const connection = new ZoneConnection('conn-1', 'zone-1', 'zone-2');
    
    connection.setMetadata({ label: 'Test', priority: 1 });
    
    expect(connection.metadata.label).toBe('Test');
    expect(connection.metadata.priority).toBe(1);
  });

  it('should serialize and deserialize', () => {
    const original = new ZoneConnection('conn-1', 'zone-1', 'zone-2', 'conditional', {
      label: 'Test Connection',
      priority: 5,
    });
    
    const data = original.toJSON();
    const restored = ZoneConnection.fromJSON(data);
    
    expect(restored.id).toBe(original.id);
    expect(restored.sourceZoneId).toBe(original.sourceZoneId);
    expect(restored.targetZoneId).toBe(original.targetZoneId);
    expect(restored.type).toBe(original.type);
    expect(restored.metadata.label).toBe('Test Connection');
  });
});