/**
 * CombatPowerCalculator Tests
 */

import { CombatPowerCalculator, CombatPowerScore, COMBAT_DIMENSIONS, CombatDimension } from '@/stratix-rts/ui/CombatPowerCalculator';

describe('CombatPowerCalculator', () => {
  describe('calculate', () => {
    it('should calculate combat power from attributes', () => {
      const attributes = {
        health: 80,
        attack: 15,
        defense: 12,
        speed: 7,
        mana: 30,
        critChance: 25,
        critDamage: 150,
        blockChance: 20,
        dodgeChance: 15,
        armor: 8,
        regen: 3,
        manaRegen: 5,
        magicDamage: 10,
      };

      const result = CombatPowerCalculator.calculate(attributes);

      expect(result).toHaveProperty('overall');
      expect(result).toHaveProperty('breakdown');
      expect(result).toHaveProperty('details');

      // Overall should be between 0 and 100
      expect(result.overall).toBeGreaterThanOrEqual(0);
      expect(result.overall).toBeLessThanOrEqual(100);

      // All breakdown dimensions should be present
      COMBAT_DIMENSIONS.forEach((dim) => {
        expect(result.breakdown[dim]).toBeGreaterThanOrEqual(0);
        expect(result.breakdown[dim]).toBeLessThanOrEqual(100);
      });
    });

    it('should return zero scores for empty attributes', () => {
      const attributes = {};
      const result = CombatPowerCalculator.calculate(attributes);

      expect(result.overall).toBe(0);
      COMBAT_DIMENSIONS.forEach((dim) => {
        expect(result.breakdown[dim]).toBe(0);
      });
    });

    it('should handle partial attributes', () => {
      const attributes = {
        attack: 20,
        health: 50,
      };

      const result = CombatPowerCalculator.calculate(attributes);

      expect(result.overall).toBeGreaterThan(0);
      expect(result.breakdown.Offense).toBeGreaterThan(0);
      expect(result.breakdown.Survivability).toBeGreaterThan(0);
    });

    it('should cap individual dimension scores at 100', () => {
      const attributes = {
        attack: 100, // Very high attack
        critChance: 100, // 50 max -> 200%
        critDamage: 500, // Very high
      };

      const result = CombatPowerCalculator.calculate(attributes);

      // Offense dimension should be capped
      expect(result.breakdown.Offense).toBeLessThanOrEqual(100);
    });

    it('should weight dimensions correctly for overall score', () => {
      const combatAttributes = {
        attack: 20,
        critChance: 50,
        critDamage: 200,
        defense: 30,
        armor: 30,
        blockChance: 50,
        speed: 10,
        dodgeChance: 50,
        mana: 50,
        manaRegen: 10,
        magicDamage: 30,
        health: 100,
        regen: 10,
      };

      const result = CombatPowerCalculator.calculate(combatAttributes);

      // Overall should be a weighted average
      const expectedOffense = result.breakdown.Offense;
      const expectedDefense = result.breakdown.Defense;
      const expectedSurvivability = result.breakdown.Survivability;

      // The weighted sum of dimensions should roughly equal overall
      const weights = {
        Offense: 0.25,
        Defense: 0.15,
        Mobility: 0.15,
        Magic: 0.15,
        Survivability: 0.20,
        Utility: 0.10,
      };

      const weightedSum = COMBAT_DIMENSIONS.reduce(
        (sum, dim) => sum + result.breakdown[dim] * weights[dim],
        0
      );

      // Overall should approximately equal weighted sum (within rounding)
      expect(Math.abs(result.overall - weightedSum)).toBeLessThanOrEqual(1);
    });
  });

  describe('toAgentScores', () => {
    it('should convert to AgentScores format', () => {
      const attributes = {
        health: 80,
        attack: 15,
        defense: 12,
        speed: 7,
      };

      const agentScores = CombatPowerCalculator.toAgentScores(attributes);

      expect(agentScores).toHaveProperty('Speed');
      expect(agentScores).toHaveProperty('Accuracy');
      expect(agentScores).toHaveProperty('Creativity');
      expect(agentScores).toHaveProperty('Reliability');
      expect(agentScores).toHaveProperty('Complexity');
      expect(agentScores).toHaveProperty('Collaboration');
    });

    it('should map dimensions correctly', () => {
      const attributes = {
        health: 80,
        attack: 15,
        defense: 12,
        speed: 7,
        mana: 30,
        critChance: 25,
        critDamage: 150,
        blockChance: 20,
        dodgeChance: 15,
        armor: 8,
        regen: 3,
        manaRegen: 5,
        magicDamage: 10,
      };

      const combatResult = CombatPowerCalculator.calculate(attributes);
      const agentScores = CombatPowerCalculator.toAgentScores(attributes);

      // Check mapping: Mobility -> Speed, Offense -> Accuracy, etc.
      expect(agentScores.Speed).toBe(combatResult.breakdown.Mobility);
      expect(agentScores.Accuracy).toBe(combatResult.breakdown.Offense);
      expect(agentScores.Creativity).toBe(combatResult.breakdown.Magic);
      expect(agentScores.Reliability).toBe(combatResult.breakdown.Defense);
      expect(agentScores.Complexity).toBe(combatResult.breakdown.Utility);
      expect(agentScores.Collaboration).toBe(combatResult.breakdown.Survivability);
    });
  });

  describe('getPowerLevel', () => {
    it('should return correct level for legendary score', () => {
      const level = CombatPowerCalculator.getPowerLevel(95);
      expect(level.level).toBe('传说');
      expect(level.color).toBe('#ffd700');
    });

    it('should return correct level for elite score', () => {
      const level = CombatPowerCalculator.getPowerLevel(80);
      expect(level.level).toBe('精英');
      expect(level.color).toBe('#c0c0c0');
    });

    it('should return correct level for excellent score', () => {
      const level = CombatPowerCalculator.getPowerLevel(65);
      expect(level.level).toBe('优秀');
      expect(level.color).toBe('#4169e1');
    });

    it('should return correct level for normal score', () => {
      const level = CombatPowerCalculator.getPowerLevel(50);
      expect(level.level).toBe('普通');
      expect(level.color).toBe('#228b22');
    });

    it('should return correct level for beginner score', () => {
      const level = CombatPowerCalculator.getPowerLevel(30);
      expect(level.level).toBe('新手');
      expect(level.color).toBe('#808080');
    });

    it('should handle boundary values', () => {
      expect(CombatPowerCalculator.getPowerLevel(90).level).toBe('传说');
      expect(CombatPowerCalculator.getPowerLevel(89).level).toBe('精英');
      expect(CombatPowerCalculator.getPowerLevel(75).level).toBe('精英');
      expect(CombatPowerCalculator.getPowerLevel(74).level).toBe('优秀');
      expect(CombatPowerCalculator.getPowerLevel(60).level).toBe('优秀');
      expect(CombatPowerCalculator.getPowerLevel(59).level).toBe('普通');
      expect(CombatPowerCalculator.getPowerLevel(40).level).toBe('普通');
      expect(CombatPowerCalculator.getPowerLevel(39).level).toBe('新手');
    });
  });

  describe('edge cases', () => {
    it('should handle very small attribute values', () => {
      const attributes = {
        health: 0.1,
        attack: 0.1,
      };

      const result = CombatPowerCalculator.calculate(attributes);

      expect(result.overall).toBeGreaterThanOrEqual(0);
      expect(result.overall).toBeLessThanOrEqual(100);
    });

    it('should handle negative attribute values gracefully', () => {
      const attributes = {
        health: -10,
        attack: 20,
      };

      const result = CombatPowerCalculator.calculate(attributes);

      // Should still produce valid scores
      expect(result.overall).toBeGreaterThanOrEqual(0);
    });

    it('should handle missing attributes as zero', () => {
      const attributes = {
        attack: 20,
      };

      const result = CombatPowerCalculator.calculate(attributes);

      // Should calculate offense based on attack alone
      expect(result.breakdown.Offense).toBeGreaterThan(0);
    });
  });
});

describe('COMBAT_DIMENSIONS', () => {
  it('should have 6 dimensions', () => {
    expect(COMBAT_DIMENSIONS).toHaveLength(6);
  });

  it('should contain expected dimensions', () => {
    expect(COMBAT_DIMENSIONS).toContain('Offense');
    expect(COMBAT_DIMENSIONS).toContain('Defense');
    expect(COMBAT_DIMENSIONS).toContain('Mobility');
    expect(COMBAT_DIMENSIONS).toContain('Magic');
    expect(COMBAT_DIMENSIONS).toContain('Survivability');
    expect(COMBAT_DIMENSIONS).toContain('Utility');
  });
});
