import Phaser from 'phaser';

import { BlueprintEdge, BlueprintNode } from '../types';

export class DependencyLine extends Phaser.GameObjects.Graphics {
  private edge: BlueprintEdge;
  private fromNode: BlueprintNode;
  private toNode: BlueprintNode;
  
  constructor(
    scene: Phaser.Scene,
    edge: BlueprintEdge,
    fromNode: BlueprintNode,
    toNode: BlueprintNode
  ) {
    super(scene);
    
    this.edge = edge;
    this.fromNode = fromNode;
    this.toNode = toNode;
    
    this.draw();
  }
  
  private draw(): void {
    this.clear();
    
    const fromX = this.fromNode.x;
    const fromY = this.fromNode.y + this.fromNode.height / 2;
    const toX = this.toNode.x;
    const toY = this.toNode.y - this.toNode.height / 2;
    
    this.lineStyle(2, 0x3498db, 0.8);
    
    const midY = (fromY + toY) / 2;
    
    this.beginPath();
    this.moveTo(fromX, fromY);
    this.lineTo(fromX, midY);
    this.lineTo(toX, midY);
    this.lineTo(toX, toY);
    this.strokePath();
    
    this.drawArrow(toX, toY, toX, midY);
  }
  
  private drawArrow(toX: number, toY: number, fromX: number, fromY: number): void {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const arrowLength = 10;
    
    this.fillStyle(0x3498db, 0.8);
    
    this.beginPath();
    this.moveTo(toX, toY);
    this.lineTo(
      toX - arrowLength * Math.cos(angle - Math.PI / 6),
      toY - arrowLength * Math.sin(angle - Math.PI / 6)
    );
    this.lineTo(
      toX - arrowLength * Math.cos(angle + Math.PI / 6),
      toY - arrowLength * Math.sin(angle + Math.PI / 6)
    );
    this.closePath();
    this.fillPath();
  }
  
  update(): void {
    this.draw();
  }
  
  getEdge(): BlueprintEdge {
    return this.edge;
  }
}
