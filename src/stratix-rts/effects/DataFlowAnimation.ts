import Phaser from 'phaser';
import { ConnectionPoint } from '../zones/ZoneConnection';

export type DataFlowStatus = 'normal' | 'warning' | 'error';

export interface DataFlowOptions {
  speed?: number;
  color?: number;
  volume?: number;
  particleCount?: number;
  particleSize?: number;
  glowIntensity?: number;
}

export interface FlowParticle {
  t: number;
  speed: number;
  color: number;
  size: number;
  alpha: number;
  offset: number;
}

export interface ActiveFlow {
  fromZoneId: string;
  toZoneId: string;
  particles: FlowParticle[];
  options: Required<DataFlowOptions>;
  isBezier: boolean;
  controlPoints?: { cp1: ConnectionPoint; cp2: ConnectionPoint };
  sourcePos: { x: number; y: number };
  targetPos: { x: number; y: number };
  graphics: Phaser.GameObjects.Graphics;
}

const STATUS_COLORS: Record<DataFlowStatus, number> = {
  normal: 0x00ff88,
  warning: 0xffcc00,
  error: 0xff4444,
};

const DEFAULT_PARTICLE_COUNT = 5;
const DEFAULT_PARTICLE_SIZE = 4;
const DEFAULT_SPEED = 0.0003;
const DEFAULT_GLOW_INTENSITY = 0.6;

export class DataFlowAnimation {
  private scene: Phaser.Scene;
  private flows: Map<string, ActiveFlow> = new Map();
  private zonePositions: Map<string, { x: number; y: number }> = new Map();
  private depth: number = 55;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  private getFlowKey(fromZoneId: string, toZoneId: string): string {
    return `${fromZoneId}->${toZoneId}`;
  }

  setZonePosition(zoneId: string, x: number, y: number): void {
    this.zonePositions.set(zoneId, { x, y });
  }

  startFlow(
    fromZoneId: string,
    toZoneId: string,
    options: DataFlowOptions = {}
  ): void {
    const key = this.getFlowKey(fromZoneId, toZoneId);

    if (this.flows.has(key)) {
      this.stopFlow(fromZoneId, toZoneId);
    }

    const sourcePos = this.zonePositions.get(fromZoneId);
    const targetPos = this.zonePositions.get(toZoneId);

    if (!sourcePos || !targetPos) {
      console.warn(`[DataFlowAnimation] Zone positions not found for ${fromZoneId} or ${toZoneId}`);
      return;
    }

    const status = this.getStatusFromVolume(options.volume ?? 1);
    const color = options.color ?? STATUS_COLORS[status];
    const particleCount = options.particleCount ?? DEFAULT_PARTICLE_COUNT;
    const particleSize = options.particleSize ?? DEFAULT_PARTICLE_SIZE;
    const speed = options.speed ?? DEFAULT_SPEED;
    const glowIntensity = options.glowIntensity ?? DEFAULT_GLOW_INTENSITY;

    const particles: FlowParticle[] = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        t: i / particleCount,
        speed: speed * (0.8 + Math.random() * 0.4),
        color,
        size: particleSize * (0.8 + Math.random() * 0.4),
        alpha: 1,
        offset: Math.random(),
      });
    }

    const graphics = this.scene.add.graphics();
    graphics.setDepth(this.depth);

    const isBezier = this.isDiagonalConnection(sourcePos, targetPos);
    let controlPoints: { cp1: ConnectionPoint; cp2: ConnectionPoint } | undefined;

    if (isBezier) {
      controlPoints = {
        cp1: this.calculateControlPoint(sourcePos, targetPos, 'source'),
        cp2: this.calculateControlPoint(sourcePos, targetPos, 'target'),
      };
    }

    const flow: ActiveFlow = {
      fromZoneId,
      toZoneId,
      particles,
      options: {
        speed,
        color,
        volume: options.volume ?? 1,
        particleCount,
        particleSize,
        glowIntensity,
      },
      isBezier,
      controlPoints,
      sourcePos,
      targetPos,
      graphics,
    };

    this.flows.set(key, flow);
  }

  stopFlow(fromZoneId: string, toZoneId: string): void {
    const key = this.getFlowKey(fromZoneId, toZoneId);
    const flow = this.flows.get(key);

    if (flow) {
      flow.graphics.destroy();
      this.flows.delete(key);
    }
  }

  update(delta: number): void {
    for (const flow of this.flows.values()) {
      flow.graphics.clear();

      for (const particle of flow.particles) {
        particle.t += particle.speed * delta;

        if (particle.t > 1) {
          particle.t = 0;
        }

        let pos: { x: number; y: number };
        if (flow.isBezier && flow.controlPoints) {
          pos = this.getPointOnBezierCurve(
            flow.sourcePos,
            flow.controlPoints.cp1,
            flow.controlPoints.cp2,
            flow.targetPos,
            particle.t
          );
        } else {
          pos = this.getPointOnLine(flow.sourcePos, flow.targetPos, particle.t);
        }

        const alpha = Math.sin(particle.t * Math.PI) * flow.options.glowIntensity + (1 - flow.options.glowIntensity);
        const size = particle.size * (0.5 + Math.sin(particle.t * Math.PI) * 0.5);

        flow.graphics.fillStyle(particle.color, alpha * 0.3);
        flow.graphics.fillCircle(pos.x - 2, pos.y - 2, size * 2);
        flow.graphics.fillStyle(particle.color, alpha * 0.6);
        flow.graphics.fillCircle(pos.x - 1, pos.y - 1, size * 1.5);
        flow.graphics.fillStyle(particle.color, alpha);
        flow.graphics.fillCircle(pos.x, pos.y, size);
      }
    }
  }

  destroy(): void {
    for (const flow of this.flows.values()) {
      flow.graphics.destroy();
    }
    this.flows.clear();
    this.zonePositions.clear();
  }

  private getStatusFromVolume(volume: number): DataFlowStatus {
    if (volume >= 0.7) return 'normal';
    if (volume >= 0.3) return 'warning';
    return 'error';
  }

  private isDiagonalConnection(source: { x: number; y: number }, target: { x: number; y: number }): boolean {
    const dx = Math.abs(target.x - source.x);
    const dy = Math.abs(target.y - source.y);
    return dy > dx * 0.5;
  }

  private calculateControlPoint(
    source: { x: number; y: number },
    target: { x: number; y: number },
    type: 'source' | 'target'
  ): ConnectionPoint {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const offset = Math.min(distance * 0.3, 100);

    if (type === 'source') {
      return { x: source.x + offset, y: source.y };
    } else {
      return { x: target.x - offset, y: target.y };
    }
  }

  private getPointOnLine(
    source: { x: number; y: number },
    target: { x: number; y: number },
    t: number
  ): { x: number; y: number } {
    return {
      x: source.x + (target.x - source.x) * t,
      y: source.y + (target.y - source.y) * t,
    };
  }

  private getPointOnBezierCurve(
    source: { x: number; y: number },
    cp1: ConnectionPoint,
    cp2: ConnectionPoint,
    target: { x: number; y: number },
    t: number
  ): { x: number; y: number } {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    return {
      x: uuu * source.x + 3 * uu * t * cp1.x + 3 * u * tt * cp2.x + ttt * target.x,
      y: uuu * source.y + 3 * uu * t * cp1.y + 3 * u * tt * cp2.y + ttt * target.y,
    };
  }

  getActiveFlows(): Array<{ from: string; to: string }> {
    return Array.from(this.flows.keys()).map((key) => {
      const [from, to] = key.split('->');
      return { from, to };
    });
  }

  hasFlow(fromZoneId: string, toZoneId: string): boolean {
    return this.flows.has(this.getFlowKey(fromZoneId, toZoneId));
  }
}
