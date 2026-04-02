import Phaser from 'phaser';

import type { AgentSprite } from '../sprites/AgentSprite';
import type { CollisionSystem } from '../systems/CollisionSystem';
import type { MovementSystem } from '../systems/MovementSystem';
import type { SpatialHashGrid } from '../systems/SpatialHashGrid';

import { CollisionDebugger } from './CollisionDebugger';
import { MovementDebugger } from './MovementDebugger';
import { SpatialGridDebugger } from './SpatialGridDebugger';

export class DebugManager {
  private scene: Phaser.Scene;
  private collisionDebugger: CollisionDebugger;
  private movementDebugger: MovementDebugger;
  private spatialGridDebugger: SpatialGridDebugger | null;
  
  constructor(
    scene: Phaser.Scene,
    collisionSystem: CollisionSystem,
    movementSystem: MovementSystem,
    spatialGrid?: SpatialHashGrid | null
  ) {
    this.scene = scene;
    
    this.collisionDebugger = new CollisionDebugger(scene, collisionSystem);
    this.movementDebugger = new MovementDebugger(scene, movementSystem);
    
    if (spatialGrid) {
      this.spatialGridDebugger = new SpatialGridDebugger(
        scene,
        spatialGrid,
        collisionSystem.getCollisionRadius() * 3
      );
    } else {
      this.spatialGridDebugger = null;
    }
  }
  
  update(agents: Map<string, AgentSprite>): void {
    this.collisionDebugger.render(agents);
    this.movementDebugger.render(agents);
    this.spatialGridDebugger?.render();
  }
  
  toggleCollision(): void {
    this.collisionDebugger.toggle();
  }
  
  toggleMovement(): void {
    this.movementDebugger.toggle();
  }
  
  toggleSpatialGrid(): void {
    this.spatialGridDebugger?.toggle();
  }
  
  enableCollision(): void {
    this.collisionDebugger.enable();
  }
  
  disableCollision(): void {
    this.collisionDebugger.disable();
  }
  
  enableMovement(): void {
    this.movementDebugger.enable();
  }
  
  disableMovement(): void {
    this.movementDebugger.disable();
  }
  
  enableSpatialGrid(): void {
    this.spatialGridDebugger?.enable();
  }
  
  disableSpatialGrid(): void {
    this.spatialGridDebugger?.disable();
  }
  
  disableAll(): void {
    this.collisionDebugger.disable();
    this.movementDebugger.disable();
    this.spatialGridDebugger?.disable();
  }
  
  isCollisionEnabled(): boolean {
    return this.collisionDebugger.isEnabled();
  }
  
  isMovementEnabled(): boolean {
    return this.movementDebugger.isEnabled();
  }
  
  isSpatialGridEnabled(): boolean {
    return this.spatialGridDebugger?.isEnabled() || false;
  }
  
  destroy(): void {
    this.collisionDebugger.destroy();
    this.movementDebugger.destroy();
    this.spatialGridDebugger?.destroy();
  }
}
