import Phaser from 'phaser';
import { BlueprintNode } from '../types';
import { TASK_TYPE_COLORS } from './colors';

export class TaskNode extends Phaser.GameObjects.Container {
  private node: BlueprintNode;
  private background: Phaser.GameObjects.Rectangle;
  private nameText: Phaser.GameObjects.Text;
  private typeText: Phaser.GameObjects.Text;
  private priorityBadge: Phaser.GameObjects.Container;
  private isHovered: boolean = false;
  private isSelected: boolean = false;
  
  constructor(scene: Phaser.Scene, node: BlueprintNode) {
    super(scene, node.x, node.y);
    
    this.node = node;
    
    this.createVisuals();
    this.setupInteractions();
  }
  
  private createVisuals(): void {
    const color = TASK_TYPE_COLORS[this.node.type] || 0x95A5A6;
    
    this.background = this.scene.add.rectangle(
      0,
      0,
      this.node.width,
      this.node.height,
      color,
      0.8
    );
    this.background.setStrokeStyle(2, color);
    this.add(this.background);
    
    this.nameText = this.scene.add.text(
      0,
      -15,
      this.node.name,
      {
        fontSize: '14px',
        fontFamily: 'Arial',
        color: '#ffffff',
        fontStyle: 'bold',
      }
    );
    this.nameText.setOrigin(0.5, 0.5);
    this.add(this.nameText);
    
    const typeNames: Record<string, string> = {
      requirement: '需求分析',
      design: '设计',
      development: '开发',
      test: '测试',
      deploy: '部署',
      writing: '写作',
      research: '研究',
      custom: '自定义',
    };
    
    this.typeText = this.scene.add.text(
      0,
      10,
      typeNames[this.node.type] || '任务',
      {
        fontSize: '12px',
        fontFamily: 'Arial',
        color: '#ffffff',
      }
    );
    this.typeText.setOrigin(0.5, 0.5);
    this.add(this.typeText);
    
    this.priorityBadge = this.createPriorityBadge();
    this.add(this.priorityBadge);
    
    this.setSize(this.node.width, this.node.height);
  }
  
  private createPriorityBadge(): Phaser.GameObjects.Container {
    const badge = this.scene.add.container(
      this.node.width / 2 - 15,
      -this.node.height / 2 + 15
    );
    
    const bg = this.scene.add.circle(0, 0, 12, 0x2c3e50);
    badge.add(bg);
    
    const text = this.scene.add.text(0, 0, `P${this.node.priority}`, {
      fontSize: '10px',
      fontFamily: 'Arial',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    text.setOrigin(0.5, 0.5);
    badge.add(text);
    
    return badge;
  }
  
  private setupInteractions(): void {
    this.setInteractive({ useHandCursor: true, draggable: true });
    
    this.on('pointerover', () => {
      this.isHovered = true;
      this.updateVisuals();
    });
    
    this.on('pointerout', () => {
      this.isHovered = false;
      this.updateVisuals();
    });
    
    this.on('pointerdown', () => {
      this.emit('node-selected', this.node);
    });
    
    this.on('drag', (pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      this.x = dragX;
      this.y = dragY;
      this.node.x = dragX;
      this.node.y = dragY;
      this.emit('node-moved', this.node);
    });
  }
  
  private updateVisuals(): void {
    const color = TASK_TYPE_COLORS[this.node.type] || 0x95A5A6;
    
    if (this.isSelected) {
      this.background.setFillStyle(color, 1);
      this.background.setStrokeStyle(3, 0xffffff);
    } else if (this.isHovered) {
      this.background.setFillStyle(color, 0.9);
      this.background.setStrokeStyle(2, 0xffffff);
    } else {
      this.background.setFillStyle(color, 0.8);
      this.background.setStrokeStyle(2, color);
    }
  }
  
  setSelected(selected: boolean): void {
    this.isSelected = selected;
    this.updateVisuals();
  }
  
  getNode(): BlueprintNode {
    return this.node;
  }
  
  updateNode(updates: Partial<BlueprintNode>): void {
    this.node = { ...this.node, ...updates };
    
    if (updates.name) {
      this.nameText.setText(updates.name);
    }
    
    if (updates.priority) {
      const text = this.priorityBadge.getAt(1) as Phaser.GameObjects.Text;
      text.setText(`P${updates.priority}`);
    }
  }
}
