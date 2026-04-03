/**
 * CombatPowerCalculator - 计算 Agent 战斗力的核心模块
 *
 * 基于 Agent 的属性（health, attack, defense, speed 等）计算综合战斗力评分
 * 采用加权评分体系，将不同属性映射到统一维度
 */

import type { AgentScores } from './AgentRadarChart';

export const COMBAT_DIMENSIONS = [
  'Offense',
  'Defense',
  'Mobility',
  'Magic',
  'Survivability',
  'Utility',
] as const;

export type CombatDimension = (typeof COMBAT_DIMENSIONS)[number];

export interface CombatPowerScore {
  overall: number;              // 综合战斗力 (0-100)
  breakdown: {
    Offense: number;            // 攻击力
    Defense: number;             // 防御力
    Mobility: number;           // 机动性
    Magic: number;              // 魔法力
    Survivability: number;       // 生存能力
    Utility: number;            // 辅助能力
  };
  details: {
    offenseScore: number;       // 原始攻击得分
    defenseScore: number;       // 原始防御得分
    mobilityScore: number;      // 原始机动得分
    magicScore: number;         // 原始魔法得分
    survivabilityScore: number; // 原始生存得分
    utilityScore: number;       // 原始辅助得分
  };
}

/**
 * 属性到战斗维度的映射配置
 * 每个维度由多个属性加权组成
 */
const ATTRIBUTE_WEIGHTS: Record<CombatDimension, Array<{ attr: string; weight: number; maxValue: number }>> = {
  Offense: [
    { attr: 'attack', weight: 0.5, maxValue: 20 },
    { attr: 'critChance', weight: 0.2, maxValue: 50 },
    { attr: 'critDamage', weight: 0.3, maxValue: 200 },
  ],
  Defense: [
    { attr: 'defense', weight: 0.4, maxValue: 30 },
    { attr: 'armor', weight: 0.3, maxValue: 30 },
    { attr: 'blockChance', weight: 0.3, maxValue: 50 },
  ],
  Mobility: [
    { attr: 'speed', weight: 0.6, maxValue: 10 },
    { attr: 'dodgeChance', weight: 0.4, maxValue: 50 },
  ],
  Magic: [
    { attr: 'mana', weight: 0.3, maxValue: 50 },
    { attr: 'manaRegen', weight: 0.2, maxValue: 10 },
    { attr: 'magicDamage', weight: 0.5, maxValue: 30 },
  ],
  Survivability: [
    { attr: 'health', weight: 0.5, maxValue: 100 },
    { attr: 'regen', weight: 0.3, maxValue: 10 },
    { attr: 'dodgeChance', weight: 0.2, maxValue: 50 },
  ],
  Utility: [
    { attr: 'manaRegen', weight: 0.3, maxValue: 10 },
    { attr: 'regen', weight: 0.3, maxValue: 10 },
    { attr: 'blockChance', weight: 0.2, maxValue: 50 },
    { attr: 'speed', weight: 0.2, maxValue: 10 },
  ],
};

/**
 * 归一化属性值到 0-100 范围
 */
function normalizeAttribute(value: number, maxValue: number): number {
  return Math.min(100, (value / maxValue) * 100);
}

/**
 * 计算单个维度的原始得分（归一化前）
 */
function calculateDimensionRawScore(
  dimension: CombatDimension,
  attributes: Record<string, number>
): number {
  const weights = ATTRIBUTE_WEIGHTS[dimension];
  let weightedSum = 0;
  let totalWeight = 0;

  for (const { attr, weight, maxValue } of weights) {
    const value = attributes[attr] ?? 0;
    const normalized = normalizeAttribute(value, maxValue);
    weightedSum += normalized * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * 计算单个维度的最终得分（0-100）
 */
function calculateDimensionScore(
  dimension: CombatDimension,
  attributes: Record<string, number>
): number {
  return Math.round(calculateDimensionRawScore(dimension, attributes));
}

/**
 * CombatPowerCalculator 类
 * 根据 Agent 属性计算综合战斗力
 */
export class CombatPowerCalculator {
  /**
   * 从 Agent 属性计算综合战斗力评分
   */
  static calculate(attributes: Record<string, number>): CombatPowerScore {
    const breakdown = {
      Offense: calculateDimensionScore('Offense', attributes),
      Defense: calculateDimensionScore('Defense', attributes),
      Mobility: calculateDimensionScore('Mobility', attributes),
      Magic: calculateDimensionScore('Magic', attributes),
      Survivability: calculateDimensionScore('Survivability', attributes),
      Utility: calculateDimensionScore('Utility', attributes),
    };

    const details = {
      offenseScore: calculateDimensionRawScore('Offense', attributes),
      defenseScore: calculateDimensionRawScore('Defense', attributes),
      mobilityScore: calculateDimensionRawScore('Mobility', attributes),
      magicScore: calculateDimensionRawScore('Magic', attributes),
      survivabilityScore: calculateDimensionRawScore('Survivability', attributes),
      utilityScore: calculateDimensionRawScore('Utility', attributes),
    };

    // 综合得分 = 各维度加权和（攻击和生存权重更高）
    const weights = {
      Offense: 0.25,
      Defense: 0.15,
      Mobility: 0.15,
      Magic: 0.15,
      Survivability: 0.20,
      Utility: 0.10,
    };

    const overall = Math.round(
      COMBAT_DIMENSIONS.reduce((sum, dim) => sum + breakdown[dim] * weights[dim], 0)
    );

    return {
      overall: Math.min(100, Math.max(0, overall)),
      breakdown,
      details,
    };
  }

  /**
   * 转换为 AgentRadarChart 兼容的 AgentScores 格式
   */
  static toAgentScores(attributes: Record<string, number>): AgentScores {
    const result = this.calculate(attributes);
    return {
      Speed: result.breakdown.Mobility,
      Accuracy: result.breakdown.Offense,
      Creativity: result.breakdown.Magic,
      Reliability: result.breakdown.Defense,
      Complexity: result.breakdown.Utility,
      Collaboration: result.breakdown.Survivability,
    };
  }

  /**
   * 获取战斗力等级描述
   */
  static getPowerLevel(score: number): { level: string; color: string } {
    if (score >= 90) return { level: '传说', color: '#ffd700' };
    if (score >= 75) return { level: '精英', color: '#c0c0c0' };
    if (score >= 60) return { level: '优秀', color: '#4169e1' };
    if (score >= 40) return { level: '普通', color: '#228b22' };
    return { level: '新手', color: '#808080' };
  }
}

export { DIMENSIONS, type AgentScores } from './AgentRadarChart';