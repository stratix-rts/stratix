# src/stratix-rts/ui/CombatPowerCalculator.ts

> 语言：typescript | 代码行数：191

## 概述

/**
 * CombatPowerCalculator - 计算 Agent 战斗力的核心模块
 *
 * 基于 Agent 的属性（health, attack, defense, speed 等）计算综合战斗力评分
 * 采用加权评分体系，将不同属性映射到统一维度
 */

## 类

| 类名 | 方法数 | 说明 |
|------|--------|------|
| `CombatPowerCalculator` | 0 | - |

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `normalizeAttribute` | `value: number, maxValue: numbe` | - |
| `calculateDimensionRawScore` | `dimension: CombatDimension, at` | - |
| `calculateDimensionScore` | `dimension: CombatDimension, at` | - |

## 依赖

- ./AgentRadarChart
