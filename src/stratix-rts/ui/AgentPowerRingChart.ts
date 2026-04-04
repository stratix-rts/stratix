/**
 * AgentPowerRingChart - 环形图组件，用于展示 Agent 战斗力 breakdown
 *
 * 显示 6 个维度的分布：Offense, Defense, Mobility, Magic, Survivability, Utility
 * 每个维度用不同颜色表示，形成环形图
 */

import Phaser from 'phaser';
import { COMBAT_DIMENSIONS, CombatDimension } from './CombatPowerCalculator';

export interface RingSegment {
  dimension: CombatDimension;
  score: number;
  color: number;
  alpha: number;
}

const DIMENSION_COLORS: Record<CombatDimension, number> = {
  Offense: 0xef4444,     // 红色 - 攻击
  Defense: 0x3b82f6,     // 蓝色 - 防御
  Mobility: 0x22c55e,   // 绿色 - 机动
  Magic: 0xa855f7,       // 紫色 - 魔法
  Survivability: 0xf59e0b, // 橙色 - 生存
  Utility: 0x06b6d4,     // 青色 - 辅助
};

const DIMENSION_ALPHA = 0.85;
const SEGMENT_GAP = 0.02; // 段之间的间隙（弧度）

export class AgentPowerRingChart {
  private scene: Phaser.Scene;
  private x: number;
  private y: number;
  private outerRadius: number;
  private innerRadius: number;
  private graphics!: Phaser.GameObjects.Graphics;
  private centerText!: Phaser.GameObjects.Text | null;
  private segments: RingSegment[] = [];
  private currentOverall: number = 0;
  private targetOverall: number = 0;
  private animationDuration: number = 600;
  private animationStartTime: number = 0;
  private isAnimating: boolean = false;
  private destroyed: boolean = false;
  private agentName: string = '';
  private agentNameText!: Phaser.GameObjects.Text | null;

  // Center text style
  private readonly CENTER_TEXT_COLOR = '#ffffff';
  private readonly CENTER_TEXT_FONT_SIZE = '24px';
  private readonly AGENT_NAME_FONT_SIZE = '14px';

  constructor(scene: Phaser.Scene, x: number, y: number, outerRadius: number = 70, innerRadius: number = 45) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.outerRadius = outerRadius;
    this.innerRadius = innerRadius;

    this.createGraphics();
    this.drawEmptyRing();
  }

  private createGraphics(): void {
    this.graphics = this.scene.add.graphics();
    this.graphics.setDepth(2);
  }

  /**
   * 绘制空环形（背景）
   */
  private drawEmptyRing(): void {
    this.graphics.clear();

    // 背景环形
    this.graphics.lineStyle(this.outerRadius - this.innerRadius, 0x374151, 0.3);
    this.graphics.beginPath();
    this.graphics.arc(this.x, this.y, (this.outerRadius + this.innerRadius) / 2, 0, Math.PI * 2);
    this.graphics.strokePath();
  }

  /**
   * 更新环形图数据
   */
  public setScores(breakdown: Record<CombatDimension, number>, animate: boolean = true): void {
    if (this.destroyed) return;

    // 构建段数据
    this.segments = COMBAT_DIMENSIONS.map((dim) => ({
      dimension: dim,
      score: Math.max(0, Math.min(100, breakdown[dim])),
      color: DIMENSION_COLORS[dim],
      alpha: DIMENSION_ALPHA,
    }));

    // 计算总得分
    const weights = { Offense: 0.25, Defense: 0.15, Mobility: 0.15, Magic: 0.15, Survivability: 0.20, Utility: 0.10 };
    this.targetOverall = Math.round(
      COMBAT_DIMENSIONS.reduce((sum, dim) => sum + (breakdown[dim] ?? 0) * weights[dim], 0)
    );

    if (animate) {
      this.animationStartTime = this.scene.time.now;
      this.isAnimating = true;
    } else {
      this.currentOverall = this.targetOverall;
      this.isAnimating = false;
    }

    this.drawRing();
    this.updateCenterText();
  }

  /**
   * 绘制环形图
   */
  private drawRing(): void {
    this.graphics.clear();

    // 背景环形
    this.graphics.lineStyle(this.outerRadius - this.innerRadius, 0x374151, 0.3);
    this.graphics.beginPath();
    this.graphics.arc(this.x, this.y, (this.outerRadius + this.innerRadius) / 2, 0, Math.PI * 2);
    this.graphics.strokePath();

    if (this.segments.length === 0) return;

    // 计算每个段的角度
    const totalScore = this.segments.reduce((sum, seg) => sum + seg.score, 0);
    if (totalScore === 0) return;

    let currentAngle = -Math.PI / 2; // 从顶部开始

    for (const segment of this.segments) {
      const segmentAngle = (segment.score / totalScore) * Math.PI * 2;
      const gapAngle = SEGMENT_GAP;

      if (segmentAngle > gapAngle) {
        const startAngle = currentAngle + gapAngle / 2;
        const endAngle = currentAngle + segmentAngle - gapAngle / 2;

        // 绘制段
        this.graphics.lineStyle(this.outerRadius - this.innerRadius, segment.color, segment.alpha);
        this.graphics.beginPath();
        this.graphics.arc(this.x, this.y, (this.outerRadius + this.innerRadius) / 2, startAngle, endAngle);
        this.graphics.strokePath();

        currentAngle += segmentAngle;
      }
    }
  }

  /**
   * 更新中心文字
   */
  private updateCenterText(): void {
    const displayScore = this.isAnimating
      ? Math.round(this.currentOverall)
      : this.targetOverall;

    if (this.centerText) {
      this.centerText.setText(String(displayScore));
    } else {
      this.centerText = this.scene.add.text(this.x, this.y, String(displayScore), {
        fontSize: this.CENTER_TEXT_FONT_SIZE,
        color: this.CENTER_TEXT_COLOR,
        fontStyle: 'bold',
      });
      this.centerText.setOrigin(0.5, 0.5);
      this.centerText.setDepth(3);
    }
  }

  /**
   * 设置 Agent 名称
   */
  public setAgentName(name: string): void {
    if (this.destroyed) return;

    this.agentName = name;

    if (this.agentNameText) {
      this.agentNameText.destroy();
    }

    if (name) {
      this.agentNameText = this.scene.add.text(this.x, this.y + this.outerRadius + 18, name, {
        fontSize: this.AGENT_NAME_FONT_SIZE,
        color: '#9ca3af',
        fontStyle: 'bold',
      });
      this.agentNameText.setOrigin(0.5, 0);
      this.agentNameText.setDepth(3);
    } else {
      this.agentNameText = null;
    }
  }

  /**
   * 每帧更新（处理动画）
   */
  public update(time: number): void {
    if (this.destroyed || !this.isAnimating) return;

    const elapsed = time - this.animationStartTime;
    const progress = Math.min(elapsed / this.animationDuration, 1);

    // ease out cubic
    const easedProgress = 1 - Math.pow(1 - progress, 3);

    this.currentOverall = this.targetOverall * easedProgress;

    // 重新绘制（只更新中心数字）
    this.drawRing();
    this.updateCenterText();

    if (progress >= 1) {
      this.isAnimating = false;
      this.currentOverall = this.targetOverall;
      this.drawRing();
      this.updateCenterText();
    }
  }

  /**
   * 获取当前总分
   */
  public getOverallScore(): number {
    return this.isAnimating ? Math.round(this.currentOverall) : this.targetOverall;
  }

  /**
   * 获取段数据
   */
  public getSegments(): RingSegment[] {
    return [...this.segments];
  }

  /**
   * 销毁组件
   */
  public destroy(): void {
    this.destroyed = true;
    this.graphics.destroy();

    if (this.centerText) {
      this.centerText.destroy();
      this.centerText = null;
    }

    if (this.agentNameText) {
      this.agentNameText.destroy();
      this.agentNameText = null;
    }
  }
}

export { COMBAT_DIMENSIONS, CombatDimension } from './CombatPowerCalculator';