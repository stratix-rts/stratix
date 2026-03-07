export type ConnectionType = 'sequential' | 'parallel' | 'conditional' | 'loop' | 'branch';

export interface ConnectionMetadata {
  label?: string;
  description?: string;
  condition?: string;
  priority?: number;
  delay?: number;
  customData?: Record<string, unknown>;
}

export interface ConnectionPoint {
  x: number;
  y: number;
}

export interface ZoneConnectionData {
  id: string;
  sourceZoneId: string;
  targetZoneId: string;
  type: ConnectionType;
  metadata: ConnectionMetadata;
  sourcePoint?: ConnectionPoint;
  targetPoint?: ConnectionPoint;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConnectionGraph {
  nodes: string[];
  edges: ZoneConnectionData[];
  adjacencyList: Map<string, string[]>;
}

export class ZoneConnection {
  private data: ZoneConnectionData;

  constructor(
    id: string,
    sourceZoneId: string,
    targetZoneId: string,
    type: ConnectionType = 'sequential',
    metadata: ConnectionMetadata = {}
  ) {
    this.data = {
      id,
      sourceZoneId,
      targetZoneId,
      type,
      metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  get id(): string {
    return this.data.id;
  }

  get sourceZoneId(): string {
    return this.data.sourceZoneId;
  }

  get targetZoneId(): string {
    return this.data.targetZoneId;
  }

  get type(): ConnectionType {
    return this.data.type;
  }

  get metadata(): ConnectionMetadata {
    return this.data.metadata;
  }

  get sourcePoint(): ConnectionPoint | undefined {
    return this.data.sourcePoint;
  }

  get targetPoint(): ConnectionPoint | undefined {
    return this.data.targetPoint;
  }

  get createdAt(): number {
    return this.data.createdAt;
  }

  get updatedAt(): number {
    return this.data.updatedAt;
  }

  setType(type: ConnectionType): void {
    this.data.type = type;
    this.data.updatedAt = Date.now();
  }

  setMetadata(metadata: Partial<ConnectionMetadata>): void {
    this.data.metadata = { ...this.data.metadata, ...metadata };
    this.data.updatedAt = Date.now();
  }

  setSourcePoint(point: ConnectionPoint): void {
    this.data.sourcePoint = point;
    this.data.updatedAt = Date.now();
  }

  setTargetPoint(point: ConnectionPoint): void {
    this.data.targetPoint = point;
    this.data.updatedAt = Date.now();
  }

  toJSON(): ZoneConnectionData {
    return { ...this.data };
  }

  static fromJSON(data: ZoneConnectionData): ZoneConnection {
    const connection = new ZoneConnection(
      data.id,
      data.sourceZoneId,
      data.targetZoneId,
      data.type,
      data.metadata
    );
    connection.data.createdAt = data.createdAt;
    connection.data.updatedAt = data.updatedAt;
    if (data.sourcePoint) connection.data.sourcePoint = data.sourcePoint;
    if (data.targetPoint) connection.data.targetPoint = data.targetPoint;
    return connection;
  }
}