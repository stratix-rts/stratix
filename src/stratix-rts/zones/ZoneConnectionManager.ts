import { rtsEventBus } from '../events/core/RTSEventBus';

import { ZoneConnection, type ConnectionType, type ConnectionMetadata, type ConnectionPoint, type ConnectionValidationResult, type ConnectionGraph, type ZoneConnectionData } from './ZoneConnection';

export interface ConnectionManagerOptions {
  maxConnectionsPerZone?: number;
  allowSelfConnections?: boolean;
  allowCyclicConnections?: boolean;
}

export class ZoneConnectionManager {
  private connections: Map<string, ZoneConnection> = new Map();
  private zoneConnections: Map<string, Set<string>> = new Map();
  private options: Required<ConnectionManagerOptions>;

  constructor(options: ConnectionManagerOptions = {}) {
    this.options = {
      maxConnectionsPerZone: options.maxConnectionsPerZone ?? 50,
      allowSelfConnections: options.allowSelfConnections ?? false,
      allowCyclicConnections: options.allowCyclicConnections ?? true,
    };
  }

  createConnection(
    sourceZoneId: string,
    targetZoneId: string,
    type: ConnectionType = 'sequential',
    metadata: ConnectionMetadata = {}
  ): ZoneConnection | null {
    const validation = this.validateConnection(sourceZoneId, targetZoneId, type);
    if (!validation.valid) {
      console.error('[ZoneConnectionManager] Invalid connection:', validation.errors);
      return null;
    }

    const id = this.generateConnectionId(sourceZoneId, targetZoneId);
    const connection = new ZoneConnection(id, sourceZoneId, targetZoneId, type, metadata);
    
    this.connections.set(id, connection);
    this.addToZoneConnections(sourceZoneId, id);
    this.addToZoneConnections(targetZoneId, id);

    this.emitConnectionEvent('connection:created', connection);

    return connection;
  }

  deleteConnection(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;

    this.connections.delete(connectionId);
    this.removeFromZoneConnections(connection.sourceZoneId, connectionId);
    this.removeFromZoneConnections(connection.targetZoneId, connectionId);

    this.emitConnectionEvent('connection:deleted', connection);

    return true;
  }

  getConnection(connectionId: string): ZoneConnection | undefined {
    return this.connections.get(connectionId);
  }

  getConnectionsByZone(zoneId: string): ZoneConnection[] {
    const connectionIds = this.zoneConnections.get(zoneId);
    if (!connectionIds) return [];

    return Array.from(connectionIds)
      .map(id => this.connections.get(id))
      .filter((conn): conn is ZoneConnection => conn !== undefined);
  }

  getOutgoingConnections(zoneId: string): ZoneConnection[] {
    return this.getConnectionsByZone(zoneId).filter(
      conn => conn.sourceZoneId === zoneId
    );
  }

  getIncomingConnections(zoneId: string): ZoneConnection[] {
    return this.getConnectionsByZone(zoneId).filter(
      conn => conn.targetZoneId === zoneId
    );
  }

  getAllConnections(): ZoneConnection[] {
    return Array.from(this.connections.values());
  }

  updateConnection(
    connectionId: string,
    updates: {
      type?: ConnectionType;
      metadata?: Partial<ConnectionMetadata>;
      sourcePoint?: ConnectionPoint;
      targetPoint?: ConnectionPoint;
    }
  ): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) return false;

    if (updates.type) connection.setType(updates.type);
    if (updates.metadata) connection.setMetadata(updates.metadata);
    if (updates.sourcePoint) connection.setSourcePoint(updates.sourcePoint);
    if (updates.targetPoint) connection.setTargetPoint(updates.targetPoint);

    this.emitConnectionEvent('connection:updated', connection);

    return true;
  }

  validateConnection(
    sourceZoneId: string,
    targetZoneId: string,
    _type: ConnectionType
  ): ConnectionValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!this.options.allowSelfConnections && sourceZoneId === targetZoneId) {
      errors.push('Self connections are not allowed');
    }

    if (!this.options.allowCyclicConnections) {
      if (this.wouldCreateCycle(sourceZoneId, targetZoneId)) {
        errors.push('This connection would create a cycle');
      }
    }

    const sourceConns = this.getConnectionsByZone(sourceZoneId);
    if (sourceConns.length >= this.options.maxConnectionsPerZone) {
      warnings.push(`Source zone has reached maximum connections (${this.options.maxConnectionsPerZone})`);
    }

    const targetConns = this.getConnectionsByZone(targetZoneId);
    if (targetConns.length >= this.options.maxConnectionsPerZone) {
      warnings.push(`Target zone has reached maximum connections (${this.options.maxConnectionsPerZone})`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  wouldCreateCycle(sourceZoneId: string, targetZoneId: string): boolean {
    const visited = new Set<string>();
    const queue = [targetZoneId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === sourceZoneId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      const outgoing = this.getOutgoingConnections(current);
      for (const conn of outgoing) {
        if (!visited.has(conn.targetZoneId)) {
          queue.push(conn.targetZoneId);
        }
      }
    }

    return false;
  }

  getGraph(): ConnectionGraph {
    const nodes = new Set<string>();
    const adjacencyList = new Map<string, string[]>();

    for (const connection of this.connections.values()) {
      nodes.add(connection.sourceZoneId);
      nodes.add(connection.targetZoneId);

      if (!adjacencyList.has(connection.sourceZoneId)) {
        adjacencyList.set(connection.sourceZoneId, []);
      }
      adjacencyList.get(connection.sourceZoneId)!.push(connection.targetZoneId);
    }

    return {
      nodes: Array.from(nodes),
      edges: this.getAllConnections().map(c => c.toJSON()),
      adjacencyList,
    };
  }

  findPath(startZoneId: string, endZoneId: string): string[] | null {
    if (startZoneId === endZoneId) return [startZoneId];

    const visited = new Set<string>();
    const queue: { zoneId: string; path: string[] }[] = [
      { zoneId: startZoneId, path: [startZoneId] },
    ];

    while (queue.length > 0) {
      const { zoneId, path } = queue.shift()!;
      if (visited.has(zoneId)) continue;
      visited.add(zoneId);

      const outgoing = this.getOutgoingConnections(zoneId);
      for (const conn of outgoing) {
        if (conn.targetZoneId === endZoneId) {
          return [...path, endZoneId];
        }
        if (!visited.has(conn.targetZoneId)) {
          queue.push({
            zoneId: conn.targetZoneId,
            path: [...path, conn.targetZoneId],
          });
        }
      }
    }

    return null;
  }

  clearConnectionsForZone(zoneId: string): number {
    const connections = this.getConnectionsByZone(zoneId);
    let count = 0;
    for (const conn of connections) {
      if (this.deleteConnection(conn.id)) {
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.connections.clear();
    this.zoneConnections.clear();
  }

  serialize(): ZoneConnectionData[] {
    return this.getAllConnections().map(c => c.toJSON());
  }

  deserialize(data: ZoneConnectionData[]): void {
    this.clear();
    for (const connData of data) {
      const connection = ZoneConnection.fromJSON(connData);
      this.connections.set(connection.id, connection);
      this.addToZoneConnections(connection.sourceZoneId, connection.id);
      this.addToZoneConnections(connection.targetZoneId, connection.id);
    }
  }

  private generateConnectionId(sourceId: string, targetId: string): string {
    return `conn-${sourceId.slice(0, 8)}-${targetId.slice(0, 8)}-${Date.now().toString(36)}`;
  }

  private addToZoneConnections(zoneId: string, connectionId: string): void {
    if (!this.zoneConnections.has(zoneId)) {
      this.zoneConnections.set(zoneId, new Set());
    }
    this.zoneConnections.get(zoneId)!.add(connectionId);
  }

  private removeFromZoneConnections(zoneId: string, connectionId: string): void {
    const connections = this.zoneConnections.get(zoneId);
    if (connections) {
      connections.delete(connectionId);
      if (connections.size === 0) {
        this.zoneConnections.delete(zoneId);
      }
    }
  }

  private emitConnectionEvent(event: string, connection: ZoneConnection): void {
    rtsEventBus.emit(event as any, {
      connectionId: connection.id,
      sourceZoneId: connection.sourceZoneId,
      targetZoneId: connection.targetZoneId,
      type: connection.type,
      metadata: connection.metadata,
      timestamp: Date.now(),
    } as any);
  }
}