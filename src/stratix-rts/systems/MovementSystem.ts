import Phaser from 'phaser';

import { angleToLPCRow } from '@/stratix-character-creator/constants';

import type { AgentSprite } from '../sprites/AgentSprite';


interface MovementState {
  agentId: string;
  targetX: number;
  targetY: number;
  speed: number;
  startTime: number;
  startDirection?: number;
}

type MovementCompleteCallback = (agentId: string, x: number, y: number) => void;

export class MovementSystem {
  private movingAgents: Map<string, MovementState> = new Map();
  private readonly DEFAULT_SPEED = 300;
  private readonly ARRIVAL_THRESHOLD = 5;
  private onMovementComplete: MovementCompleteCallback | null = null;

  setOnMovementComplete(callback: MovementCompleteCallback): void {
    this.onMovementComplete = callback;
  }

  moveTo(agentId: string, targetX: number, targetY: number, speed?: number): void {
    const movementSpeed = speed ?? this.DEFAULT_SPEED;
    
    this.movingAgents.set(agentId, {
      agentId,
      targetX,
      targetY,
      speed: movementSpeed,
      startTime: Date.now()
    });
  }

  stop(agentId: string): void {
    this.movingAgents.delete(agentId);
  }

  stopAll(): void {
    this.movingAgents.clear();
  }

  isMoving(agentId: string): boolean {
    return this.movingAgents.has(agentId);
  }

  getTarget(agentId: string): { x: number; y: number } | null {
    const state = this.movingAgents.get(agentId);
    if (!state) return null;
    return { x: state.targetX, y: state.targetY };
  }

  update(delta: number, agents: Map<string, AgentSprite>): void {
    const completedMoves: string[] = [];

    this.movingAgents.forEach((state, agentId) => {
      const agent = agents.get(agentId);
      if (!agent) {
        completedMoves.push(agentId);
        return;
      }

      const dx = state.targetX - agent.x;
      const dy = state.targetY - agent.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < this.ARRIVAL_THRESHOLD) {
        agent.setPosition(state.targetX, state.targetY);
        const direction = state.startDirection ?? this.getDirection(agent.x, agent.y, state.targetX, state.targetY);
        agent.playAnimation('idle', direction);
        agent.updateDepth();
        completedMoves.push(agentId);
        return;
      }

      const direction = this.getDirection(agent.x, agent.y, state.targetX, state.targetY);

      if (!state.startDirection || state.startDirection !== direction) {
        state.startDirection = direction;
      }

      agent.playAnimation('run', direction);

      const velocity = new Phaser.Math.Vector2(dx, dy).normalize();
      const moveDistance = state.speed * (delta / 1000);

      if (moveDistance >= distance) {
        agent.setPosition(state.targetX, state.targetY);
        agent.playAnimation('idle', direction);
        agent.updateDepth();
        completedMoves.push(agentId);
      } else {
        agent.x += velocity.x * moveDistance;
        agent.y += velocity.y * moveDistance;
        agent.updateDepth();
      }
    });

    completedMoves.forEach(agentId => {
      const state = this.movingAgents.get(agentId);
      if (state && this.onMovementComplete) {
        this.onMovementComplete(agentId, state.targetX, state.targetY);
      }
      this.movingAgents.delete(agentId);
    });
  }

  private getDirection(fromX: number, fromY: number, toX: number, toY: number): number {
    const angle = Phaser.Math.Angle.Between(fromX, fromY, toX, toY);
    const deg = Phaser.Math.RadToDeg(angle);
    const normalized = ((deg % 360) + 360) % 360;
    
    return angleToLPCRow(normalized);
  }

  getMovingAgentCount(): number {
    return this.movingAgents.size;
  }

  getAllMovingAgents(): string[] {
    return Array.from(this.movingAgents.keys());
  }

  clear(): void {
    this.movingAgents.clear();
  }
}
