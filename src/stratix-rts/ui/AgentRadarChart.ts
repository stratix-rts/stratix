/**
 * AgentRadarChart - Hexagonal radar/spider chart for agent capability visualization
 *
 * Displays 6 dimensions: Speed, Accuracy, Creativity, Reliability, Complexity, Collaboration
 * Each dimension scored 0-100, rendered as a filled polygon on a hexagonal grid.
 */

import Phaser from 'phaser';

export const DIMENSIONS = [
  'Speed',
  'Accuracy',
  'Creativity',
  'Reliability',
  'Complexity',
  'Collaboration',
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export interface AgentScores {
  Speed?: number;
  Accuracy?: number;
  Creativity?: number;
  Reliability?: number;
  Complexity?: number;
  Collaboration?: number;
}

export class AgentRadarChart {
  private scene: Phaser.Scene;
  private x: number;
  private y: number;
  private radius: number;
  private gridGraphics!: Phaser.GameObjects.Graphics;
  private scoreGraphics!: Phaser.GameObjects.Graphics;
  private labelTexts: Phaser.GameObjects.Text[] = [];
  private agentNameText!: Phaser.GameObjects.Text | null;
  private currentScores: number[] = [0, 0, 0, 0, 0, 0];
  private targetScores: number[] = [0, 0, 0, 0, 0, 0];
  private animationDuration: number = 500;
  private animationStartTime: number = 0;
  private isAnimating: boolean = false;
  private agentName: string = '';
  private destroyed: boolean = false;

  // Grid colors
  private readonly GRID_COLOR = 0x4a5568;
  private readonly GRID_ALPHA = 0.3;
  private readonly SCORE_FILL_COLOR = 0x3b82f6;
  private readonly SCORE_FILL_ALPHA = 0.4;
  private readonly SCORE_STROKE_COLOR = 0x3b82f6;
  private readonly SCORE_STROKE_ALPHA = 0.8;
  private readonly LABEL_COLOR = '#ffffff';
  private readonly LABEL_FONT_SIZE = '12px';

  // Label offset from vertex (percentage of radius)
  private readonly LABEL_OFFSET = 1.25;

  constructor(scene: Phaser.Scene, x: number, y: number, radius: number = 80) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.createGraphics();
    this.drawGrid();
    this.drawLabels();
  }

  private createGraphics(): void {
    this.gridGraphics = this.scene.add.graphics();
    this.gridGraphics.setDepth(1);

    this.scoreGraphics = this.scene.add.graphics();
    this.scoreGraphics.setDepth(2);
  }

  /**
   * Calculate vertex position for a hexagon at given angle
   * Angle is measured from top (12 o'clock), going clockwise
   */
  private getVertexPosition(angleDeg: number, scale: number = 1): { x: number; y: number } {
    // Convert from top-clockwise to standard math coordinates
    // Top is -90° in standard coords, so we add 90°
    const angleRad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: this.x + this.radius * scale * Math.cos(angleRad),
      y: this.y + this.radius * scale * Math.sin(angleRad),
    };
  }

  /**
   * Draw hexagonal grid lines (3 concentric hexagons at 33%, 66%, 100%)
   */
  private drawGrid(): void {
    this.gridGraphics.clear();

    const levels = [0.33, 0.66, 1.0];

    for (const level of levels) {
      this.drawHexagon(level, this.GRID_COLOR, this.GRID_ALPHA);
    }

    // Draw axis lines from center to each vertex
    for (let i = 0; i < 6; i++) {
      const angle = i * 60;
      const outerPos = this.getVertexPosition(angle, 1.0);

      this.gridGraphics.lineStyle(1, this.GRID_COLOR, this.GRID_ALPHA * 0.5);
      this.gridGraphics.lineBetween(this.x, this.y, outerPos.x, outerPos.y);
    }
  }

  /**
   * Draw a single hexagon at given scale
   */
  private drawHexagon(scale: number, color: number, alpha: number): void {
    const points: { x: number; y: number }[] = [];

    for (let i = 0; i < 6; i++) {
      const angle = i * 60;
      points.push(this.getVertexPosition(angle, scale));
    }

    this.gridGraphics.lineStyle(1, color, alpha);

    // Draw closed polygon
    for (let i = 0; i < 6; i++) {
      const start = points[i];
      const end = points[(i + 1) % 6];

      if (i === 0) {
        this.gridGraphics.beginPath();
        this.gridGraphics.moveTo(start.x, start.y);
      }
      this.gridGraphics.lineTo(end.x, end.y);
    }
    this.gridGraphics.closePath();
    this.gridGraphics.strokePath();
  }

  /**
   * Draw dimension labels at each vertex
   */
  private drawLabels(): void {
    // Clear existing labels
    this.labelTexts.forEach((label) => label.destroy());
    this.labelTexts = [];

    for (let i = 0; i < 6; i++) {
      const angle = i * 60;
      const pos = this.getVertexPosition(angle, this.LABEL_OFFSET);
      const dimension = DIMENSIONS[i];

      const label = this.scene.add.text(pos.x, pos.y, dimension, {
        fontSize: this.LABEL_FONT_SIZE,
        color: this.LABEL_COLOR,
        fontStyle: 'bold',
      });
      label.setOrigin(0.5, 0.5);
      label.setDepth(3);

      this.labelTexts.push(label);
    }
  }

  /**
   * Draw the score polygon
   */
  private drawScorePolygon(scores: number[]): void {
    this.scoreGraphics.clear();

    const points: { x: number; y: number }[] = [];

    for (let i = 0; i < 6; i++) {
      const angle = i * 60;
      const normalizedScore = Math.max(0, Math.min(100, scores[i])) / 100;
      points.push(this.getVertexPosition(angle, normalizedScore));
    }

    // Fill the polygon
    this.scoreGraphics.fillStyle(this.SCORE_FILL_COLOR, this.SCORE_FILL_ALPHA);
    this.scoreGraphics.beginPath();
    this.scoreGraphics.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < 6; i++) {
      this.scoreGraphics.lineTo(points[i].x, points[i].y);
    }
    this.scoreGraphics.closePath();
    this.scoreGraphics.fillPath();

    // Stroke the polygon
    this.scoreGraphics.lineStyle(2, this.SCORE_STROKE_COLOR, this.SCORE_STROKE_ALPHA);
    this.scoreGraphics.beginPath();
    this.scoreGraphics.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < 6; i++) {
      this.scoreGraphics.lineTo(points[i].x, points[i].y);
    }
    this.scoreGraphics.closePath();
    this.scoreGraphics.strokePath();

    // Draw dots at each vertex
    for (const point of points) {
      this.scoreGraphics.fillStyle(this.SCORE_STROKE_COLOR, 1);
      this.scoreGraphics.fillCircle(point.x, point.y, 3);
    }
  }

  /**
   * Set agent scores with animation
   */
  public setScores(scores: AgentScores): void {
    if (this.destroyed) return;

    // Convert AgentScores object to ordered array
    this.targetScores = DIMENSIONS.map((dim) => {
      const score = scores[dim];
      return typeof score === 'number' ? Math.max(0, Math.min(100, score)) : 0;
    });

    // Start animation
    this.animationStartTime = this.scene.time.now;
    this.isAnimating = true;

    // Draw immediately with current scores
    this.drawScorePolygon(this.currentScores);
  }

  /**
   * Set agent name displayed below the chart
   */
  public setAgentName(name: string): void {
    if (this.destroyed) return;

    this.agentName = name;

    if (this.agentNameText) {
      this.agentNameText.destroy();
    }

    if (name) {
      this.agentNameText = this.scene.add.text(this.x, this.y + this.radius + 20, name, {
        fontSize: '14px',
        color: this.LABEL_COLOR,
        fontStyle: 'bold',
      });
      this.agentNameText.setOrigin(0.5, 0);
      this.agentNameText.setDepth(3);
    } else {
      this.agentNameText = null;
    }
  }

  /**
   * Update called each frame - handles animation
   */
  public update(time: number): void {
    if (this.destroyed || !this.isAnimating) return;

    const elapsed = time - this.animationStartTime;
    const progress = Math.min(elapsed / this.animationDuration, 1);

    // Ease out cubic for smooth deceleration
    const easedProgress = 1 - Math.pow(1 - progress, 3);

    // Interpolate scores
    for (let i = 0; i < 6; i++) {
      const startScore = this.currentScores[i];
      const endScore = this.targetScores[i];
      this.currentScores[i] = startScore + (endScore - startScore) * easedProgress;
    }

    // Draw animated polygon
    this.drawScorePolygon(this.currentScores);

    // Check if animation complete
    if (progress >= 1) {
      this.isAnimating = false;
      // Ensure final scores are exact
      this.currentScores = [...this.targetScores];
      this.drawScorePolygon(this.currentScores);
    }
  }

  /**
   * Get current scores
   */
  public getScores(): AgentScores {
    const scores: AgentScores = {};
    DIMENSIONS.forEach((dim, i) => {
      scores[dim] = Math.round(this.currentScores[i]);
    });
    return scores;
  }

  /**
   * Get current agent name
   */
  public getAgentName(): string {
    return this.agentName;
  }

  /**
   * Check if animation is in progress
   */
  public isAnimatingScores(): boolean {
    return this.isAnimating;
  }

  /**
   * Clean up all resources
   */
  public destroy(): void {
    this.destroyed = true;

    this.gridGraphics.destroy();
    this.scoreGraphics.destroy();

    this.labelTexts.forEach((label) => label.destroy());
    this.labelTexts = [];

    if (this.agentNameText) {
      this.agentNameText.destroy();
      this.agentNameText = null;
    }
  }
}