import Phaser from 'phaser';

import { type ConnectionType, type ConnectionPoint } from './ZoneConnection';

export interface ConnectionLineStyle {
  color: number;
  alpha: number;
  lineWidth: number;
  dashArray?: number[];
}

export interface ConnectionRenderOptions {
  animated?: boolean;
  showArrow?: boolean;
  showLabel?: boolean;
  lineStyle?: Partial<ConnectionLineStyle>;
  hoverWidth?: number;
  selectedWidth?: number;
}

const CONNECTION_STYLES: Record<ConnectionType, ConnectionLineStyle> = {
  sequential: { color: 0x4a90e2, alpha: 0.8, lineWidth: 2 },
  parallel: { color: 0x50c878, alpha: 0.8, lineWidth: 2, dashArray: [10, 5] },
  conditional: { color: 0xf5a623, alpha: 0.8, lineWidth: 2, dashArray: [5, 5] },
  loop: { color: 0x9b59b6, alpha: 0.8, lineWidth: 2, dashArray: [15, 5, 5, 5] },
  branch: { color: 0xe74c3c, alpha: 0.8, lineWidth: 2, dashArray: [8, 3] },
};

export class ConnectionRenderer {
  private scene: Phaser.Scene;
  private graphics: Phaser.GameObjects.Graphics;
  private animatedConnections: Map<string, { offset: number; connection: any; controlPoints?: { cp1: ConnectionPoint; cp2: ConnectionPoint } }> = new Map();
  private animationActive: boolean = false;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(50);
  }

  renderConnection(
    connectionId: string,
    sourcePos: { x: number; y: number },
    targetPos: { x: number; y: number },
    type: ConnectionType,
    options: ConnectionRenderOptions = {}
  ): void {
    const style = { ...CONNECTION_STYLES[type], ...options.lineStyle };

    this.graphics.save();

    if (style.dashArray && style.dashArray.length > 0) {
      this.drawDashedLine(sourcePos, targetPos, style, options);
    } else {
      this.drawSolidLine(sourcePos, targetPos, style, options);
    }

    if (options.showArrow !== false) {
      this.drawArrow(targetPos, sourcePos, style.color, style.alpha);
    }

    this.graphics.restore();

    if (options.animated) {
      this.addAnimatedConnection(connectionId, sourcePos, targetPos, style, type);
    }
  }

  renderBezierConnection(
    connectionId: string,
    sourcePos: { x: number; y: number },
    targetPos: { x: number; y: number },
    type: ConnectionType,
    controlPoints?: { cp1?: ConnectionPoint; cp2?: ConnectionPoint },
    options: ConnectionRenderOptions = {}
  ): void {
    const style = { ...CONNECTION_STYLES[type], ...options.lineStyle };

    const cp1 = controlPoints?.cp1 || this.calculateControlPoint(sourcePos, targetPos, 'source');
    const cp2 = controlPoints?.cp2 || this.calculateControlPoint(sourcePos, targetPos, 'target');

    this.graphics.save();

    if (style.dashArray && style.dashArray.length > 0) {
      this.drawDashedBezierCurve(sourcePos, targetPos, cp1, cp2, style, options);
    } else {
      this.drawBezierCurve(sourcePos, targetPos, cp1, cp2, style, options);
    }

    if (options.showArrow !== false) {
      const arrowPos = this.getPointOnBezierCurve(sourcePos, cp1, cp2, targetPos, 0.9);
      const arrowAngle = this.getBezierCurveAngle(sourcePos, cp1, cp2, targetPos, 0.9);
      this.drawArrowAt(arrowPos, arrowAngle, style.color, style.alpha);
    }

    this.graphics.restore();

    if (options.animated) {
      this.addAnimatedConnection(connectionId, sourcePos, targetPos, style, type, { cp1, cp2 });
    }
  }

  clearConnection(_connectionId: string): void {
    this.animatedConnections.delete(_connectionId);
  }

  clear(): void {
    this.graphics.clear();
    this.animatedConnections.clear();
  }

  destroy(): void {
    this.graphics.destroy();
    this.animatedConnections.clear();
    this.animationActive = false;
  }

  update(delta: number): void {
    if (this.animatedConnections.size === 0) return;

    this.graphics.clear();

    for (const [connectionId, data] of this.animatedConnections) {
      data.offset += delta * 0.001;
      if (data.offset > 100) data.offset = 0;

      if (data.controlPoints) {
        this.drawAnimatedBezierConnection(connectionId, data);
      } else {
        this.drawAnimatedStraightConnection(connectionId, data);
      }
    }
  }

  startAnimation(): void {
    if (this.animationActive) return;
    this.animationActive = true;
  }

  stopAnimation(): void {
    this.animationActive = false;
  }

  setDepth(depth: number): void {
    this.graphics.setDepth(depth);
  }

  getDepth(): number {
    return this.graphics.depth;
  }

  hitTest(
    x: number,
    y: number,
    sourcePos: { x: number; y: number },
    targetPos: { x: number; y: number },
    threshold: number = 10
  ): boolean {
    const distance = this.pointToLineDistance(x, y, sourcePos, targetPos);
    return distance <= threshold;
  }

  hitTestBezier(
    x: number,
    y: number,
    sourcePos: { x: number; y: number },
    targetPos: { x: number; y: number },
    cp1: ConnectionPoint,
    cp2: ConnectionPoint,
    threshold: number = 10,
    samples: number = 50
  ): boolean {
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const point = this.getPointOnBezierCurve(sourcePos, cp1, cp2, targetPos, t);
      const distance = Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2);
      if (distance <= threshold) return true;
    }
    return false;
  }

  private drawSolidLine(
    source: { x: number; y: number },
    target: { x: number; y: number },
    style: ConnectionLineStyle,
    _options: ConnectionRenderOptions
  ): void {
    this.graphics.lineStyle(style.lineWidth, style.color, style.alpha);
    this.graphics.beginPath();
    this.graphics.moveTo(source.x, source.y);
    this.graphics.lineTo(target.x, target.y);
    this.graphics.strokePath();
  }

  private drawDashedLine(
    source: { x: number; y: number },
    target: { x: number; y: number },
    style: ConnectionLineStyle,
    _options: ConnectionRenderOptions
  ): void {
    const dashArray = style.dashArray || [10, 5];
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const unitX = dx / length;
    const unitY = dy / length;

    let currentLength = 0;
    let isDash = true;
    let dashIndex = 0;

    this.graphics.lineStyle(style.lineWidth, style.color, style.alpha);

    while (currentLength < length) {
      const dashLength = dashArray[dashIndex % dashArray.length];
      const startLength = currentLength;
      const endLength = Math.min(currentLength + dashLength, length);

      const startX = source.x + unitX * startLength;
      const startY = source.y + unitY * startLength;
      const endX = source.x + unitX * endLength;
      const endY = source.y + unitY * endLength;

      if (isDash) {
        this.graphics.beginPath();
        this.graphics.moveTo(startX, startY);
        this.graphics.lineTo(endX, endY);
        this.graphics.strokePath();
      }

      currentLength = endLength;
      isDash = !isDash;
      dashIndex++;
    }
  }

  private drawBezierCurve(
    source: { x: number; y: number },
    target: { x: number; y: number },
    cp1: ConnectionPoint,
    cp2: ConnectionPoint,
    style: ConnectionLineStyle,
    _options: ConnectionRenderOptions
  ): void {
    this.graphics.lineStyle(style.lineWidth, style.color, style.alpha);
    this.graphics.beginPath();
    this.graphics.moveTo(source.x, source.y);
    
    const samples = 50;
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const point = this.getPointOnBezierCurve(source, cp1, cp2, target, t);
      this.graphics.lineTo(point.x, point.y);
    }
    
    this.graphics.strokePath();
  }

  private drawDashedBezierCurve(
    source: { x: number; y: number },
    target: { x: number; y: number },
    cp1: ConnectionPoint,
    cp2: ConnectionPoint,
    style: ConnectionLineStyle,
    _options: ConnectionRenderOptions
  ): void {
    const dashArray = style.dashArray || [10, 5];
    const samples = 100;

    let currentLength = 0;
    let isDash = true;
    let dashIndex = 0;

    this.graphics.lineStyle(style.lineWidth, style.color, style.alpha);

    for (let i = 0; i < samples; i++) {
      const t1 = i / samples;
      const t2 = (i + 1) / samples;

      const p1 = this.getPointOnBezierCurve(source, cp1, cp2, target, t1);
      const p2 = this.getPointOnBezierCurve(source, cp1, cp2, target, t2);

      const segmentLength = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
      let remainingLength = segmentLength;

      while (remainingLength > 0 && currentLength < 1) {
        const dashLength = dashArray[dashIndex % dashArray.length];
        const startT = t1 + (segmentLength - remainingLength) / segmentLength * (t2 - t1);
        
        if (isDash) {
          const endT = Math.min(t2, startT + (dashLength / segmentLength) * (t2 - t1));
          const drawP1 = this.getPointOnBezierCurve(source, cp1, cp2, target, startT);
          const drawP2 = this.getPointOnBezierCurve(source, cp1, cp2, target, endT);
          
          this.graphics.beginPath();
          this.graphics.moveTo(drawP1.x, drawP1.y);
          this.graphics.lineTo(drawP2.x, drawP2.y);
          this.graphics.strokePath();
        }

        remainingLength -= dashLength;
        dashIndex++;
        isDash = !isDash;
      }

      currentLength = (i + 1) / samples;
    }
  }

  private drawArrow(
    target: { x: number; y: number },
    source: { x: number; y: number },
    color: number,
    alpha: number
  ): void {
    const angle = Math.atan2(target.y - source.y, target.x - source.x);
    this.drawArrowAt(target, angle, color, alpha);
  }

  private drawArrowAt(
    pos: { x: number; y: number },
    angle: number,
    color: number,
    alpha: number
  ): void {
    const arrowLength = 12;
    const arrowAngle = Math.PI / 6;

    const p1 = {
      x: pos.x - arrowLength * Math.cos(angle - arrowAngle),
      y: pos.y - arrowLength * Math.sin(angle - arrowAngle),
    };

    const p2 = {
      x: pos.x - arrowLength * Math.cos(angle + arrowAngle),
      y: pos.y - arrowLength * Math.sin(angle + arrowAngle),
    };

    this.graphics.fillStyle(color, alpha);
    this.graphics.beginPath();
    this.graphics.moveTo(pos.x, pos.y);
    this.graphics.lineTo(p1.x, p1.y);
    this.graphics.lineTo(p2.x, p2.y);
    this.graphics.closePath();
    this.graphics.fillPath();
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
      return {
        x: source.x + offset,
        y: source.y,
      };
    } else {
      return {
        x: target.x - offset,
        y: target.y,
      };
    }
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

    const x = uuu * source.x + 3 * uu * t * cp1.x + 3 * u * tt * cp2.x + ttt * target.x;
    const y = uuu * source.y + 3 * uu * t * cp1.y + 3 * u * tt * cp2.y + ttt * target.y;

    return { x, y };
  }

  private getBezierCurveAngle(
    source: { x: number; y: number },
    cp1: ConnectionPoint,
    cp2: ConnectionPoint,
    target: { x: number; y: number },
    t: number
  ): number {
    const dt = 0.001;
    const p1 = this.getPointOnBezierCurve(source, cp1, cp2, target, Math.max(0, t - dt));
    const p2 = this.getPointOnBezierCurve(source, cp1, cp2, target, Math.min(1, t + dt));
    return Math.atan2(p2.y - p1.y, p2.x - p1.x);
  }

  private pointToLineDistance(
    px: number,
    py: number,
    lineStart: { x: number; y: number },
    lineEnd: { x: number; y: number }
  ): number {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) return Math.sqrt((px - lineStart.x) ** 2 + (py - lineStart.y) ** 2);

    const t = Math.max(0, Math.min(1, ((px - lineStart.x) * dx + (py - lineStart.y) * dy) / (length * length)));
    const nearestX = lineStart.x + t * dx;
    const nearestY = lineStart.y + t * dy;

    return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
  }

  private addAnimatedConnection(
    connectionId: string,
    source: { x: number; y: number },
    target: { x: number; y: number },
    style: ConnectionLineStyle,
    type: ConnectionType,
    controlPoints?: { cp1: ConnectionPoint; cp2: ConnectionPoint }
  ): void {
    this.animatedConnections.set(connectionId, {
      offset: 0,
      connection: {
        source,
        target,
        style,
        type,
        controlPoints,
      },
    });
  }

  private drawAnimatedStraightConnection(_connectionId: string, data: any): void {
    const { source, target, style } = data.connection;
    const dashArray = style.dashArray || [10, 5];
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) return;

    const unitX = dx / length;
    const unitY = dy / length;

    // Use offset to create moving dash effect
    const totalDashLength = dashArray.reduce((a: number, b: number) => a + b, 0);
    const startOffset = (data.offset / 100) * totalDashLength;

    let currentLength = -startOffset;
    let isDash = true;
    let dashIndex = 0;

    this.graphics.lineStyle(style.lineWidth, style.color, style.alpha);

    while (currentLength < length) {
      const dashLength = dashArray[dashIndex % dashArray.length];
      const startLength = Math.max(0, currentLength);
      const endLength = Math.min(currentLength + dashLength, length);

      if (isDash && endLength > startLength) {
        const startX = source.x + unitX * startLength;
        const startY = source.y + unitY * startLength;
        const endX = source.x + unitX * endLength;
        const endY = source.y + unitY * endLength;

        this.graphics.beginPath();
        this.graphics.moveTo(startX, startY);
        this.graphics.lineTo(endX, endY);
        this.graphics.strokePath();
      }

      currentLength += dashLength;
      isDash = !isDash;
      dashIndex++;
    }

    // Draw arrow at target (always visible, on top)
    this.drawArrow(target, source, style.color, style.alpha);
  }

  private drawAnimatedBezierConnection(_connectionId: string, data: any): void {
    const { source, target, style, controlPoints } = data.connection;
    if (!controlPoints) return;

    const { cp1, cp2 } = controlPoints;
    const dashArray = style.dashArray || [10, 5];
    const samples = 100;
    const totalDashLength = dashArray.reduce((a: number, b: number) => a + b, 0);
    const startOffset = (data.offset / 100) * totalDashLength;

    // Calculate total curve length
    let curveLength = 0;
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const point = this.getPointOnBezierCurve(source, cp1, cp2, target, t);
      points.push(point);
      if (i > 0) {
        const prev = points[i - 1];
        curveLength += Math.sqrt((point.x - prev.x) ** 2 + (point.y - prev.y) ** 2);
      }
    }

    let currentLength = -startOffset;
    let isDash = true;
    let dashIndex = 0;

    this.graphics.lineStyle(style.lineWidth, style.color, style.alpha);

    for (let i = 0; i < samples; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const segmentLength = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);

      while (currentLength >= 0 && currentLength < segmentLength && !isDash) {
        currentLength += dashArray[dashIndex % dashArray.length];
        isDash = !isDash;
        dashIndex++;
      }

      if (isDash) {
        const remainingInDash = dashArray[(dashIndex - 1 + dashArray.length) % dashArray.length] - currentLength;
        const t1 = currentLength / segmentLength;
        const t2 = Math.min(1, t1 + remainingInDash / segmentLength);

        const startT = i / samples + t1 * (1 / samples);
        const endT = i / samples + t2 * (1 / samples);

        const drawP1 = this.getPointOnBezierCurve(source, cp1, cp2, target, startT);
        const drawP2 = this.getPointOnBezierCurve(source, cp1, cp2, target, endT);

        this.graphics.beginPath();
        this.graphics.moveTo(drawP1.x, drawP1.y);
        this.graphics.lineTo(drawP2.x, drawP2.y);
        this.graphics.strokePath();
      }

      currentLength -= segmentLength;
    }

    // Draw arrow at target (always visible, on top)
    const arrowPos = this.getPointOnBezierCurve(source, cp1, cp2, target, 0.9);
    const arrowAngle = this.getBezierCurveAngle(source, cp1, cp2, target, 0.9);
    this.drawArrowAt(arrowPos, arrowAngle, style.color, style.alpha);
  }
}