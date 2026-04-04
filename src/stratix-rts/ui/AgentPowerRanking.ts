/**
 * AgentPowerRanking - Agent 战斗力排名列表组件
 *
 * 显示多个 Agent 的战斗力排名，支持：
 * - 排名序号
 * - Agent 名称
 * - 战斗力总分
 * - 等级标签
 * - 微微动画
 */

import Phaser from 'phaser';
import { CombatPowerCalculator, CombatPowerScore, COMBAT_DIMENSIONS, CombatDimension } from './CombatPowerCalculator';

export interface RankedAgent {
  agentId: string;
  name: string;
  score: CombatPowerScore;
  rank: number;
}

export interface RankingItemConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor: number;
  backgroundAlpha: number;
  onClick?: (agentId: string) => void;
}

const RANK_COLORS = ['#ffd700', '#c0c0c0', '#cd7f32']; // 金银铜
const DEFAULT_RANK_COLOR = '#6b7280';

const LEVEL_COLORS: Record<string, string> = {
  '传说': '#ffd700',
  '精英': '#c0c0c0',
  '优秀': '#4169e1',
  '普通': '#228b22',
  '新手': '#808080',
};

export class AgentPowerRanking {
  private scene: Phaser.Scene;
  private x: number;
  private y: number;
  private width: number;
  private itemHeight: number;
  private maxVisibleItems: number;
  private backgroundColor: number;
  private backgroundAlpha: number;
  private onItemClick?: (agentId: string) => void;

  private container!: Phaser.GameObjects.Container;
  private items: Phaser.GameObjects.Graphics[] = [];
  private rankTexts: Phaser.GameObjects.Text[] = [];
  private nameTexts: Phaser.GameObjects.Text[] = [];
  private scoreTexts: Phaser.GameObjects.Text[] = [];
  private levelBadges: Phaser.GameObjects.Container | null = null;

  private rankedAgents: RankedAgent[] = [];
  private destroyed: boolean = false;

  // 布局配置
  private readonly PADDING = 8;
  private readonly RANK_WIDTH = 30;
  private readonly NAME_WIDTH_RATIO = 0.5;
  private readonly SCORE_WIDTH = 50;
  private readonly FONT_SIZE = '12px';
  private readonly ITEM_ALPHA = 0.9;
  private readonly SELECTED_ALPHA = 1.0;
  private readonly HOVER_ALPHA = 0.95;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    itemHeight: number = 36,
    maxVisibleItems: number = 8,
    backgroundColor: number = 0x1f2937,
    backgroundAlpha: number = 0.85
  ) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.width = width;
    this.itemHeight = itemHeight;
    this.maxVisibleItems = maxVisibleItems;
    this.backgroundColor = backgroundColor;
    this.backgroundAlpha = backgroundAlpha;

    this.createContainer();
  }

  private createContainer(): void {
    this.container = this.scene.add.container(this.x, this.y);
    this.container.setDepth(10);
  }

  /**
   * 设置点击回调
   */
  public setOnItemClick(callback: (agentId: string) => void): void {
    this.onItemClick = callback;
  }

  /**
   * 更新排名数据
   */
  public setRankedAgents(agents: Array<{ agentId: string; name: string; attributes: Record<string, number> }>): void {
    if (this.destroyed) return;

    // 计算每个 Agent 的战斗力
    const scoredAgents = agents.map((agent) => ({
      agentId: agent.agentId,
      name: agent.name,
      score: CombatPowerCalculator.calculate(agent.attributes),
    }));

    // 按总分排序
    scoredAgents.sort((a, b) => b.score.overall - a.score.overall);

    // 添加排名
    this.rankedAgents = scoredAgents.map((agent, index) => ({
      ...agent,
      rank: index + 1,
    }));

    this.render();
  }

  /**
   * 渲染排名列表
   */
  private render(): void {
    // 清除旧元素
    this.clearItems();

    // 渲染可见项
    const visibleAgents = this.rankedAgents.slice(0, this.maxVisibleItems);

    visibleAgents.forEach((agent, index) => {
      this.createItem(agent, index);
    });
  }

  /**
   * 清除所有列表项
   */
  private clearItems(): void {
    this.items.forEach((item) => item.destroy());
    this.rankTexts.forEach((text) => text.destroy());
    this.nameTexts.forEach((text) => text.destroy());
    this.scoreTexts.forEach((text) => text.destroy());

    if (this.levelBadges) {
      this.levelBadges.destroy();
      this.levelBadges = null;
    }

    this.items = [];
    this.rankTexts = [];
    this.nameTexts = [];
    this.scoreTexts = [];
  }

  /**
   * 创建单个列表项
   */
  private createItem(agent: RankedAgent, index: number): void {
    const itemY = index * this.itemHeight;
    const itemWidth = this.width;
    const cornerRadius = 4;

    // 背景
    const background = this.scene.add.graphics();
    background.fillStyle(this.backgroundColor, this.backgroundAlpha);
    background.fillRoundedRect(0, itemY, itemWidth, this.itemHeight - 2, cornerRadius);
    background.setDepth(0);

    // 排名数字
    const rankColor = agent.rank <= 3 ? RANK_COLORS[agent.rank - 1] : DEFAULT_RANK_COLOR;
    const rankText = this.scene.add.text(this.PADDING, itemY + this.itemHeight / 2, `#${agent.rank}`, {
      fontSize: '11px',
      color: rankColor,
      fontStyle: 'bold',
    });
    rankText.setOrigin(0, 0.5);
    rankText.setDepth(1);

    // Agent 名称
    const nameX = this.PADDING + this.RANK_WIDTH;
    const nameWidth = itemWidth * this.NAME_WIDTH_RATIO;
    const nameText = this.scene.add.text(nameX, itemY + this.itemHeight / 2, agent.name, {
      fontSize: this.FONT_SIZE,
      color: '#f3f4f6',
      fontStyle: 'bold',
    });
    nameText.setOrigin(0, 0.5);
    nameText.setDepth(1);

    // 截断过长的名称
    if (nameText.width > nameWidth - this.PADDING) {
      nameText.setText(agent.name.substring(0, 10) + '...');
    }

    // 战斗力分数
    const scoreX = itemWidth - this.PADDING - this.SCORE_WIDTH;
    const powerLevel = CombatPowerCalculator.getPowerLevel(agent.score.overall);
    const scoreText = this.scene.add.text(scoreX, itemY + this.itemHeight / 2, `${agent.score.overall}`, {
      fontSize: '14px',
      color: powerLevel.color,
      fontStyle: 'bold',
    });
    scoreText.setOrigin(1, 0.5);
    scoreText.setDepth(1);

    // 添加到容器
    this.container.add([background, rankText, nameText, scoreText]);
    this.items.push(background);
    this.rankTexts.push(rankText);
    this.nameTexts.push(nameText);
    this.scoreTexts.push(scoreText);

    // 添加点击区域
    this.addClickZone(agent.agentId, itemY, this.itemHeight);
  }

  /**
   * 添加点击区域
   */
  private addClickZone(agentId: string, itemY: number, itemHeight: number): void {
    const hitArea = this.scene.add.rectangle(
      this.width / 2,
      itemY + itemHeight / 2,
      this.width,
      itemHeight,
      0x000000,
      0
    );
    hitArea.setDepth(2);
    hitArea.setInteractive({ useHandCursor: true });

    hitArea.on('pointerover', () => {
      this.scene.tweens.add({
        targets: hitArea,
        alpha: 0.1,
        duration: 100,
      });
    });

    hitArea.on('pointerout', () => {
      this.scene.tweens.add({
        targets: hitArea,
        alpha: 0,
        duration: 100,
      });
    });

    hitArea.on('pointerdown', () => {
      this.onItemClick?.(agentId);
    });

    this.container.add(hitArea);
  }

  /**
   * 获取排名数据
   */
  public getRankedAgents(): RankedAgent[] {
    return [...this.rankedAgents];
  }

  /**
   * 获取特定 Agent 的排名
   */
  public getAgentRank(agentId: string): number | null {
    const agent = this.rankedAgents.find((a) => a.agentId === agentId);
    return agent?.rank ?? null;
  }

  /**
   * 设置位置
   */
  public setPosition(x: number, y: number): void {
    if (this.destroyed) return;
    this.container.setPosition(x, y);
  }

  /**
   * 销毁组件
   */
  public destroy(): void {
    this.destroyed = true;
    this.clearItems();
    this.container.destroy();
  }
}

export { COMBAT_DIMENSIONS, CombatDimension } from './CombatPowerCalculator';
export { CombatPowerCalculator, CombatPowerScore } from './CombatPowerCalculator';