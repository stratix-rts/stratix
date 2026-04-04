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
  enableBeam?: boolean;
  enableDataPackets?: boolean;
}

export interface FlowParticle {
  t: number;
  speed: number;
  color: number;
  size: number;
  alpha: number;
  offset: number;
  trail: Array<{ x: number; y: number; alpha: number }>;
}

export interface DataPacket {
  t: number;
  speed: number;
  color: number;
  size: number;
  offset: number;
  trail: Array<{ x: number; y: number; alpha: number }>;
}

export interface ZonePulse {
  zoneId: string;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: number;
}

export interface ActiveFlow {
  fromZoneId: string;
  toZoneId: string;
  particles: FlowParticle[];
  dataPackets: DataPacket[];
  options: Required<DataFlowOptions>;
  isBezier: boolean;
  controlPoints?: { cp1: ConnectionPoint; cp2: ConnectionPoint };
  sourcePos: { x: number; y: number };
  targetPos: { x: number; y: number };
  graphics: Phaser.GameObjects.Graphics;
  beamGraphics: Phaser.GameObjects.Graphics;
  beamPhase: number;
}

const STATUS_COLORS: Record<DataFlowStatus, number> = {
  normal: 0x00ff88,
  warning: 0xffcc00,
  error: 0xff4444,
};

const DEFAULT_PARTICLE_COUNT = 8;
const DEFAULT_PARTICLE_SIZE = 3;
const DEFAULT_DATA_PACKET_COUNT = 3;
const DEFAULT_SPEED = 0.0003;
const DEFAULT_GLOW_INTENSITY = 0.6;
const TRAIL_LENGTH = 12;

export class DataFlowAnimation {
  private scene: Phaser.Scene;
  private flows: Map<string, ActiveFlow> = new Map();
  private zonePositions: Map<string, { x: number; y: number }> = new Map();
  private zonePulses: Map<string, ZonePulse> = new Map();
  private depth: number = 55;
  private agentPositions: Map<string, { x: number; y: number }> = new Map();
  private agentBeamGraphics: Phaser.GameObjects.Graphics;
  private agentPulses: Map<string, { angle: number; distance: number; alpha: number }> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.agentBeamGraphics = scene.add.graphics();
    this.agentBeamGraphics.setDepth(this.depth + 1);
  }

  private getFlowKey(fromZoneId: string, toZoneId: string): string {
    return `${fromZoneId}->${toZoneId}`;
  }

  setZonePosition(zoneId: string, x: number, y: number): void {
    this.zonePositions.set(zoneId, { x, y });
  }

  setAgentPosition(agentId: string, x: number, y: number): void {
    this.agentPositions.set(agentId, { x, y });
  }

  /**
   * Emit a pulse effect from a zone (e.g., on status change or data update)
   */
  emitZonePulse(zoneId: string, color?: number): void {
    const pos = this.zonePositions.get(zoneId);
    if (!pos) return;

    this.zonePulses.set(zoneId, {
      zoneId,
      x: pos.x,
      y: pos.y,
      radius: 10,
      maxRadius: 80,
      alpha: 1,
      color: color ?? STATUS_COLORS.normal,
    });
  }

  /**
   * Start data flow between two zones
   */
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
    const enableBeam = options.enableBeam ?? true;
    const enableDataPackets = options.enableDataPackets ?? true;

    const particles: FlowParticle[] = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        t: i / particleCount,
        speed: speed * (0.8 + Math.random() * 0.4),
        color,
        size: particleSize * (0.8 + Math.random() * 0.4),
        alpha: 1,
        offset: Math.random(),
        trail: [],
      });
    }

    // Data packets - larger, more visible particles with longer trails
    const dataPackets: DataPacket[] = [];
    if (enableDataPackets) {
      const packetCount = DEFAULT_DATA_PACKET_COUNT;
      for (let i = 0; i < packetCount; i++) {
        dataPackets.push({
          t: (i / packetCount) + 0.2,
          speed: speed * 0.8 * (0.9 + Math.random() * 0.2),
          color: 0xffffff,
          size: particleSize * 2,
          offset: Math.random(),
          trail: [],
        });
      }
    }

    const graphics = this.scene.add.graphics();
    graphics.setDepth(this.depth);

    const beamGraphics = this.scene.add.graphics();
    beamGraphics.setDepth(this.depth - 1);

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
      dataPackets,
      options: {
        speed,
        color,
        volume: options.volume ?? 1,
        particleCount,
        particleSize,
        glowIntensity,
        enableBeam,
        enableDataPackets,
      },
      isBezier,
      controlPoints,
      sourcePos,
      targetPos,
      graphics,
      beamGraphics,
      beamPhase: 0,
    };

    this.flows.set(key, flow);

    // Emit pulse at source zone
    this.emitZonePulse(fromZoneId, color);
  }

  stopFlow(fromZoneId: string, toZoneId: string): void {
    const key = this.getFlowKey(fromZoneId, toZoneId);
    const flow = this.flows.get(key);

    if (flow) {
      flow.graphics.destroy();
      flow.beamGraphics.destroy();
      // Clear particle arrays to release memory
      flow.particles.forEach(p => { p.trail.length = 0; });
      flow.dataPackets.forEach(p => { p.trail.length = 0; });
      this.flows.delete(key);
    }
  }

  /**
   * Start a beam effect between two agents
   */
  startAgentBeam(fromAgentId: string, toAgentId: string): void {
    const fromPos = this.agentPositions.get(fromAgentId);
    const toPos = this.agentPositions.get(toAgentId);

    if (!fromPos || !toPos) return;

    const key = `${fromAgentId}->${toAgentId}`;
    this.agentPulses.set(key, {
      angle: 0,
      distance: 0,
      alpha: 1,
    });
  }

  update(delta: number): void {
    // Update zone pulses
    this.updateZonePulses(delta);

    // Update agent beams
    this.updateAgentBeams(delta);

    // Update flows
    for (const flow of this.flows.values()) {
      flow.graphics.clear();
      flow.beamGraphics.clear();

      // Draw beam effect
      if (flow.options.enableBeam) {
        this.drawBeam(flow);
      }

      // Draw glowing particle trails
      this.drawGlowingParticles(flow, delta);

      // Draw data packets
      if (flow.options.enableDataPackets) {
        this.drawDataPackets(flow, delta);
      }
    }
  }

  private updateZonePulses(delta: number): void {
    const toRemove: string[] = [];

    for (const [zoneId, pulse] of this.zonePulses) {
      pulse.radius += delta * 0.15;
      pulse.alpha -= delta * 0.003;

      if (pulse.alpha <= 0 || pulse.radius >= pulse.maxRadius) {
        toRemove.push(zoneId);
      }
    }

    for (const zoneId of toRemove) {
      this.zonePulses.delete(zoneId);
    }
  }

  private updateAgentBeams(delta: number): void {
    this.agentBeamGraphics.clear();
    const toRemove: string[] = [];

    for (const [key, pulse] of this.agentPulses) {
      pulse.angle += delta * 0.005;
      pulse.distance += delta * 0.1;
      pulse.alpha -= delta * 0.002;

      if (pulse.alpha <= 0) {
        toRemove.push(key);
        continue;
      }

      const [fromId, toId] = key.split('->');
      const fromPos = this.agentPositions.get(fromId);
      const toPos = this.agentPositions.get(toId);

      if (fromPos && toPos) {
        const midX = (fromPos.x + toPos.x) / 2;
        const midY = (fromPos.y + toPos.y) / 2;
        const beamLength = Math.sqrt((toPos.x - fromPos.x) ** 2 + (toPos.y - fromPos.y) ** 2);

        // Draw expanding ring at midpoint
        this.agentBeamGraphics.lineStyle(2, 0x00ffff, pulse.alpha * 0.5);
        this.agentBeamGraphics.strokeCircle(
          midX + Math.cos(pulse.angle) * pulse.distance * 0.3,
          midY + Math.sin(pulse.angle) * pulse.distance * 0.3,
          10 + pulse.distance * 0.2
        );
      }
    }

    for (const key of toRemove) {
      this.agentPulses.delete(key);
    }
  }

  private drawBeam(flow: ActiveFlow): void {
    const { sourcePos, targetPos, beamPhase } = flow;
    const color = flow.options.color;
    const isBezier = flow.isBezier && flow.controlPoints;

    // Pulsing beam along the connection
    const beamAlpha = 0.15 + Math.sin(beamPhase) * 0.1;

    if (isBezier) {
      const { cp1, cp2 } = flow.controlPoints!;
      // Draw glow layers
      for (let layer = 3; layer >= 0; layer--) {
        const layerAlpha = beamAlpha * (0.3 - layer * 0.07);
        const layerWidth = 8 + layer * 4;
        flow.beamGraphics.lineStyle(layerWidth, color, layerAlpha);
        this.drawBezierPath(flow.beamGraphics, sourcePos, cp1, cp2, targetPos);
      }
    } else {
      for (let layer = 3; layer >= 0; layer--) {
        const layerAlpha = beamAlpha * (0.3 - layer * 0.07);
        const layerWidth = 6 + layer * 3;
        flow.beamGraphics.lineStyle(layerWidth, color, layerAlpha);
        flow.beamGraphics.beginPath();
        flow.beamGraphics.moveTo(sourcePos.x, sourcePos.y);
        flow.beamGraphics.lineTo(targetPos.x, targetPos.y);
        flow.beamGraphics.strokePath();
      }
    }

    flow.beamPhase += 0.05;
  }

  private drawBezierPath(
    graphics: Phaser.GameObjects.Graphics,
    source: { x: number; y: number },
    cp1: ConnectionPoint,
    cp2: ConnectionPoint,
    target: { x: number; y: number }
  ): void {
    const samples = 50;
    graphics.beginPath();
    graphics.moveTo(source.x, source.y);

    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const point = this.getPointOnBezierCurve(source, cp1, cp2, target, t);
      graphics.lineTo(point.x, point.y);
    }

    graphics.strokePath();
  }

  private drawGlowingParticles(flow: ActiveFlow, delta: number): void {
    for (const particle of flow.particles) {
      particle.t += particle.speed * delta;

      if (particle.t > 1) {
        particle.t = 0;
        particle.trail = [];
      }

      // Update trail
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

      particle.trail.unshift({ x: pos.x, y: pos.y, alpha: 1 });
      if (particle.trail.length > TRAIL_LENGTH) {
        particle.trail.pop();
      }

      const glowIntensity = flow.options.glowIntensity;
      const trailAlpha = Math.sin(particle.t * Math.PI) * glowIntensity + (1 - glowIntensity);

      // Draw trail with fading glow
      if (particle.trail.length > 1) {
        for (let i = 1; i < particle.trail.length; i++) {
          const t = particle.trail[i];
          const prev = particle.trail[i - 1];
          const fadeAlpha = (1 - i / particle.trail.length) * trailAlpha * 0.5;
          const size = particle.size * (1 - i / particle.trail.length) * 0.7;

          // Outer glow
          flow.graphics.fillStyle(particle.color, fadeAlpha * 0.3);
          flow.graphics.fillCircle(t.x, t.y, size * 2.5);

          // Inner glow
          flow.graphics.fillStyle(particle.color, fadeAlpha * 0.6);
          flow.graphics.fillCircle(t.x, t.y, size * 1.5);
        }
      }

      // Draw main particle with multi-layer glow
      const mainAlpha = Math.sin(particle.t * Math.PI) * glowIntensity + (1 - glowIntensity);
      const mainSize = particle.size * (0.5 + Math.sin(particle.t * Math.PI) * 0.5);

      // Outermost glow
      flow.graphics.fillStyle(particle.color, mainAlpha * 0.2);
      flow.graphics.fillCircle(pos.x, pos.y, mainSize * 4);

      // Middle glow
      flow.graphics.fillStyle(particle.color, mainAlpha * 0.4);
      flow.graphics.fillCircle(pos.x, pos.y, mainSize * 2.5);

      // Inner glow
      flow.graphics.fillStyle(particle.color, mainAlpha * 0.7);
      flow.graphics.fillCircle(pos.x, pos.y, mainSize * 1.5);

      // Core (white)
      flow.graphics.fillStyle(0xffffff, mainAlpha);
      flow.graphics.fillCircle(pos.x, pos.y, mainSize * 0.5);
    }
  }

  private drawDataPackets(flow: ActiveFlow, delta: number): void {
    for (const packet of flow.dataPackets) {
      packet.t += packet.speed * delta;

      if (packet.t > 1) {
        packet.t = 0;
        packet.trail = [];
      }

      let pos: { x: number; y: number };
      if (flow.isBezier && flow.controlPoints) {
        pos = this.getPointOnBezierCurve(
          flow.sourcePos,
          flow.controlPoints.cp1,
          flow.controlPoints.cp2,
          flow.targetPos,
          packet.t
        );
      } else {
        pos = this.getPointOnLine(flow.sourcePos, flow.targetPos, packet.t);
      }

      // Update trail
      packet.trail.unshift({ x: pos.x, y: pos.y, alpha: 1 });
      if (packet.trail.length > TRAIL_LENGTH * 2) {
        packet.trail.pop();
      }

      const pulseAlpha = Math.sin(packet.t * Math.PI);

      // Draw packet trail (energy streak effect)
      if (packet.trail.length > 1) {
        for (let i = 1; i < packet.trail.length; i++) {
          const t = packet.trail[i];
          const fade = (1 - i / packet.trail.length);
          const lineAlpha = fade * pulseAlpha * 0.6;
          const lineWidth = packet.size * fade * 0.5;

          flow.graphics.lineStyle(lineWidth, packet.color, lineAlpha);
          flow.graphics.beginPath();
          flow.graphics.moveTo(packet.trail[i - 1].x, packet.trail[i - 1].y);
          flow.graphics.lineTo(t.x, t.y);
          flow.graphics.strokePath();
        }
      }

      // Draw data packet (diamond shape)
      const size = packet.size * (0.8 + pulseAlpha * 0.4);

      // Outer glow
      flow.graphics.fillStyle(flow.options.color, pulseAlpha * 0.3);
      flow.graphics.fillRect(pos.x - size * 1.5, pos.y - size * 1.5, size * 3, size * 3);

      // Inner packet
      flow.graphics.fillStyle(packet.color, pulseAlpha);
      flow.graphics.fillRect(pos.x - size, pos.y - size, size * 2, size * 2);

      // Highlight
      flow.graphics.fillStyle(0xffffff, pulseAlpha * 0.8);
      flow.graphics.fillRect(pos.x - size * 0.5, pos.y - size * 0.5, size, size);
    }
  }

  /**
   * Draw zone pulse effects (called from scene update)
   */
  drawZonePulses(graphics: Phaser.GameObjects.Graphics): void {
    graphics.clear();

    for (const pulse of this.zonePulses.values()) {
      // Draw expanding ring
      graphics.lineStyle(3, pulse.color, pulse.alpha * 0.7);
      graphics.strokeCircle(pulse.x, pulse.y, pulse.radius);

      // Draw inner fill
      graphics.fillStyle(pulse.color, pulse.alpha * 0.1);
      graphics.fillCircle(pulse.x, pulse.y, pulse.radius);

      // Draw core
      graphics.fillStyle(pulse.color, pulse.alpha * 0.5);
      graphics.fillCircle(pulse.x, pulse.y, pulse.radius * 0.3);
    }
  }

  stopAgentBeam(fromAgentId: string, toAgentId: string): void {
    const key = `${fromAgentId}->${toAgentId}`;
    this.agentPulses.delete(key);
  }

  destroy(): void {
    for (const flow of this.flows.values()) {
      flow.graphics.destroy();
      flow.beamGraphics.destroy();
    }
    this.flows.clear();
    this.zonePositions.clear();
    this.zonePulses.clear();
    this.agentPositions.clear();
    this.agentBeamGraphics.destroy();
    this.agentPulses.clear();
    this.agentBeamGraphics = null as any;
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
