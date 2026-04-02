import { rtsEventBus } from '../events/core/RTSEventBus';
import { ZoneAction } from '../history/ZoneHistory';

import { type ConnectionType, type ConnectionMetadata } from './ZoneConnection';
import { ZoneConnectionManager } from './ZoneConnectionManager';

export interface ConnectionActionData {
  connectionId: string;
  sourceZoneId: string;
  targetZoneId: string;
  type: ConnectionType;
  metadata: ConnectionMetadata;
}

export class ConnectionCreateAction implements ZoneAction {
  id: string;
  type = 'create' as const;
  timestamp: number;
  zoneId: string;
  data: ConnectionActionData;

  constructor(
    private connectionManager: ZoneConnectionManager,
    sourceZoneId: string,
    targetZoneId: string,
    connectionType: ConnectionType = 'sequential',
    metadata: ConnectionMetadata = {}
  ) {
    this.id = `conn-create-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.timestamp = Date.now();
    this.zoneId = `${sourceZoneId}-${targetZoneId}`;
    this.data = {
      connectionId: '',
      sourceZoneId,
      targetZoneId,
      type: connectionType,
      metadata,
    };
  }

  async undo(): Promise<void> {
    if (this.data.connectionId) {
      this.connectionManager.deleteConnection(this.data.connectionId);
      rtsEventBus.emit('connection:deleted' as any, {
        connectionId: this.data.connectionId,
        isUndo: true,
      } as any);
    }
  }

  async redo(): Promise<void> {
    const connection = this.connectionManager.createConnection(
      this.data.sourceZoneId,
      this.data.targetZoneId,
      this.data.type,
      this.data.metadata
    );

    if (connection) {
      this.data.connectionId = connection.id;
      rtsEventBus.emit('connection:created' as any, {
        connectionId: connection.id,
        sourceZoneId: connection.sourceZoneId,
        targetZoneId: connection.targetZoneId,
        type: connection.type,
        isRedo: true,
      } as any);
    }
  }
}

export class ConnectionDeleteAction implements ZoneAction {
  id: string;
  type = 'delete' as const;
  timestamp: number;
  zoneId: string;
  data: ConnectionActionData;

  constructor(
    private connectionManager: ZoneConnectionManager,
    private connectionId: string
  ) {
    this.id = `conn-delete-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.timestamp = Date.now();
    
    const connection = connectionManager.getConnection(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    this.zoneId = `${connection.sourceZoneId}-${connection.targetZoneId}`;
    this.data = {
      connectionId,
      sourceZoneId: connection.sourceZoneId,
      targetZoneId: connection.targetZoneId,
      type: connection.type,
      metadata: connection.metadata,
    };
  }

  async undo(): Promise<void> {
    const connection = this.connectionManager.createConnection(
      this.data.sourceZoneId,
      this.data.targetZoneId,
      this.data.type,
      this.data.metadata
    );

    if (connection) {
      this.data.connectionId = connection.id;
      rtsEventBus.emit('connection:created' as any, {
        connectionId: connection.id,
        sourceZoneId: connection.sourceZoneId,
        targetZoneId: connection.targetZoneId,
        type: connection.type,
        isUndo: true,
      } as any);
    }
  }

  async redo(): Promise<void> {
    this.connectionManager.deleteConnection(this.data.connectionId);
    rtsEventBus.emit('connection:deleted' as any, {
      connectionId: this.data.connectionId,
      isRedo: true,
    } as any);
  }
}

export class ConnectionUpdateAction implements ZoneAction {
  id: string;
  type = 'status_change' as const;
  timestamp: number;
  zoneId: string;
  data: {
    connectionId: string;
    oldData: Partial<ConnectionActionData>;
    newData: Partial<ConnectionActionData>;
  };

  constructor(
    private connectionManager: ZoneConnectionManager,
    connectionId: string,
    updates: {
      type?: ConnectionType;
      metadata?: Partial<ConnectionMetadata>;
    }
  ) {
    this.id = `conn-update-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.timestamp = Date.now();

    const connection = connectionManager.getConnection(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    this.zoneId = `${connection.sourceZoneId}-${connection.targetZoneId}`;
    
    this.data = {
      connectionId,
      oldData: {
        sourceZoneId: connection.sourceZoneId,
        targetZoneId: connection.targetZoneId,
        type: connection.type,
        metadata: { ...connection.metadata },
      },
      newData: {
        sourceZoneId: connection.sourceZoneId,
        targetZoneId: connection.targetZoneId,
        type: updates.type ?? connection.type,
        metadata: updates.metadata ? { ...connection.metadata, ...updates.metadata } : connection.metadata,
      },
    };
  }

  async undo(): Promise<void> {
    const connection = this.connectionManager.getConnection(this.data.connectionId);
    if (connection && this.data.oldData.type) {
      connection.setType(this.data.oldData.type);
    }
    if (connection && this.data.oldData.metadata) {
      connection.setMetadata(this.data.oldData.metadata);
    }

    rtsEventBus.emit('connection:updated' as any, {
      connectionId: this.data.connectionId,
      isUndo: true,
    } as any);
  }

  async redo(): Promise<void> {
    const connection = this.connectionManager.getConnection(this.data.connectionId);
    if (connection && this.data.newData.type) {
      connection.setType(this.data.newData.type);
    }
    if (connection && this.data.newData.metadata) {
      connection.setMetadata(this.data.newData.metadata);
    }

    rtsEventBus.emit('connection:updated' as any, {
      connectionId: this.data.connectionId,
      isRedo: true,
    } as any);
  }
}