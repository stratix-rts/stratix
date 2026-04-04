import type { AgentSprite } from '../sprites/AgentSprite';

import type { MovementSystem } from './MovementSystem';

export class FormationSystem {
  private getAgentFn: (agentId: string) => AgentSprite | undefined;

  constructor(getAgentFn: (agentId: string) => AgentSprite | undefined) {
    this.getAgentFn = getAgentFn;
  }

  moveGroup(
    agentIds: string[],
    targetX: number,
    targetY: number,
    movementSystem: MovementSystem
  ): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    
    if (agentIds.length === 0) return positions;

    if (agentIds.length === 1) {
      movementSystem.moveTo(agentIds[0], targetX, targetY);
      positions.set(agentIds[0], { x: targetX, y: targetY });
      return positions;
    }

    const center = this.calculateCenter(agentIds);
    if (!center) return positions;

    agentIds.forEach(agentId => {
      const agent = this.getAgentFn(agentId);
      if (!agent) return;

      const offsetX = agent.x - center.x;
      const offsetY = agent.y - center.y;

      const destX = targetX + offsetX;
      const destY = targetY + offsetY;

      movementSystem.moveTo(agentId, destX, destY);
      positions.set(agentId, { x: destX, y: destY });
    });
    
    return positions;
  }

  private calculateCenter(agentIds: string[]): { x: number; y: number } | null {
    if (agentIds.length === 0) return null;

    let sumX = 0;
    let sumY = 0;
    let count = 0;

    agentIds.forEach(agentId => {
      const agent = this.getAgentFn(agentId);
      if (agent) {
        sumX += agent.x;
        sumY += agent.y;
        count++;
      }
    });

    if (count === 0) return null;

    return {
      x: sumX / count,
      y: sumY / count
    };
  }

  moveGroupInFormation(
    agentIds: string[],
    targetX: number,
    targetY: number,
    movementSystem: MovementSystem,
    formation: 'line' | 'box' | 'circle' = 'box'
  ): Map<string, { x: number; y: number }> {
    if (agentIds.length <= 3) {
      return this.moveGroup(agentIds, targetX, targetY, movementSystem);
    }

    const positions = new Map<string, { x: number; y: number }>();
    const formationPositions = this.calculateFormationPositions(
      agentIds.length,
      targetX,
      targetY,
      formation
    );

    agentIds.forEach((agentId, index) => {
      if (index < formationPositions.length) {
        const pos = formationPositions[index];
        movementSystem.moveTo(agentId, pos.x, pos.y);
        positions.set(agentId, { x: pos.x, y: pos.y });
      }
    });
    
    return positions;
  }

  private calculateFormationPositions(
    count: number,
    targetX: number,
    targetY: number,
    formation: 'line' | 'box' | 'circle'
  ): Array<{ x: number; y: number }> {
    const spacing = 50;
    const positions: Array<{ x: number; y: number }> = [];

    switch (formation) {
      case 'line': {
        const startX = targetX - ((count - 1) * spacing) / 2;
        for (let i = 0; i < count; i++) {
          positions.push({
            x: startX + i * spacing,
            y: targetY
          });
        }
        break;
      }

      case 'circle': {
        const radius = spacing * Math.sqrt(count / Math.PI);
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          positions.push({
            x: targetX + Math.cos(angle) * radius,
            y: targetY + Math.sin(angle) * radius
          });
        }
        break;
      }

      case 'box':
      default: {
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        const startX2 = targetX - ((cols - 1) * spacing) / 2;
        const startY2 = targetY - ((rows - 1) * spacing) / 2;

        for (let i = 0; i < count; i++) {
          const col = i % cols;
          const row = Math.floor(i / cols);
          positions.push({
            x: startX2 + col * spacing,
            y: startY2 + row * spacing
          });
        }
        break;
      }
    }

    return positions;
  }
}
