import Phaser from 'phaser';

import { ParsedTask } from '../../stratix-ai-service/types';
import { BlueprintNode, BlueprintEdge, Blueprint } from '../types';

import { DependencyLine } from './DependencyLine';
import { LayoutEngine } from './LayoutEngine';
import { TaskNode } from './TaskNode';

export class BlueprintCanvas extends Phaser.Scene {
  private nodes: Map<string, TaskNode> = new Map();
  private lines: Map<string, DependencyLine> = new Map();
  private layoutEngine: LayoutEngine;
  private blueprint: Blueprint | null = null;
  private selectedNodeId: string | null = null;
  private onNodeSelected?: (node: BlueprintNode) => void;
  
  constructor() {
    super({ key: 'BlueprintCanvas' });
    this.layoutEngine = new LayoutEngine();
  }
  
  create(): void {
    this.createGrid();
    this.setupCameraControls();
  }
  
  private createGrid(): void {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, 0x2c3e50, 0.3);
    
    const gridSize = 50;
    const width = 2000;
    const height = 2000;
    
    for (let x = 0; x <= width; x += gridSize) {
      graphics.moveTo(x, 0);
      graphics.lineTo(x, height);
    }
    
    for (let y = 0; y <= height; y += gridSize) {
      graphics.moveTo(0, y);
      graphics.lineTo(width, y);
    }
    
    graphics.strokePath();
  }
  
  private setupCameraControls(): void {
    const camera = this.cameras.main;
    
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return;
      
      if (pointer.rightButtonDown()) {
        (camera as any).startDrag(pointer);
      }
    });
    
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        camera.setScroll(
          camera.scrollX - (pointer.x - pointer.prevPosition.x) / camera.zoom,
          camera.scrollY - (pointer.y - pointer.prevPosition.y) / camera.zoom
        );
      }
    });
    
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, gameObjects: any, deltaX: number, deltaY: number) => {
      const zoomChange = deltaY > 0 ? -0.1 : 0.1;
      const newZoom = Phaser.Math.Clamp(camera.zoom + zoomChange, 0.5, 2);
      camera.setZoom(newZoom);
    });
  }
  
  loadBlueprint(tasks: ParsedTask[], projectId: string): void {
    this.clearBlueprint();
    
    const { nodes, edges } = this.layoutEngine.layout(tasks);
    
    this.blueprint = {
      id: `blueprint_${Date.now()}`,
      projectId,
      nodes,
      edges,
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        strategy: 'sequential',
      },
    };
    
    this.createNodes(nodes);
    this.createLines(edges, nodes);
    
    this.centerCamera(nodes);
  }
  
  private createNodes(nodes: BlueprintNode[]): void {
    for (const node of nodes) {
      const taskNode = new TaskNode(this, node);
      
      taskNode.on('node-selected', (node: BlueprintNode) => {
        this.selectNode(node.id);
      });
      
      taskNode.on('node-moved', (node: BlueprintNode) => {
        this.updateLines();
        this.updateBlueprintNode(node);
      });
      
      this.nodes.set(node.id, taskNode);
      this.add.existing(taskNode);
    }
  }
  
  private createLines(edges: BlueprintEdge[], nodes: BlueprintNode[]): void {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    
    for (const edge of edges) {
      const fromNode = nodeMap.get(edge.fromNodeId);
      const toNode = nodeMap.get(edge.toNodeId);
      
      if (fromNode && toNode) {
        const line = new DependencyLine(this, edge, fromNode, toNode);
        this.lines.set(edge.id, line);
        this.add.existing(line);
      }
    }
  }
  
  private updateLines(): void {
    if (!this.blueprint) return;
    
    const nodeMap = new Map(this.blueprint.nodes.map(n => [n.id, n]));
    
    for (const [edgeId, line] of this.lines) {
      const edge = this.blueprint.edges.find(e => e.id === edgeId);
      if (edge) {
        const fromNode = nodeMap.get(edge.fromNodeId);
        const toNode = nodeMap.get(edge.toNodeId);
        if (fromNode && toNode) {
          (line as any).fromNode = fromNode;
          (line as any).toNode = toNode;
          line.update();
        }
      }
    }
  }
  
  private updateBlueprintNode(node: BlueprintNode): void {
    if (!this.blueprint) return;
    
    this.blueprint.nodes = this.blueprint.nodes.map(n => 
      n.id === node.id ? node : n
    );
  }
  
  private selectNode(nodeId: string): void {
    if (this.selectedNodeId) {
      const prevNode = this.nodes.get(this.selectedNodeId);
      prevNode?.setSelected(false);
    }
    
    this.selectedNodeId = nodeId;
    const node = this.nodes.get(nodeId);
    node?.setSelected(true);
    
    if (node && this.onNodeSelected) {
      this.onNodeSelected(node.getNode());
    }
  }
  
  private clearBlueprint(): void {
    for (const node of this.nodes.values()) {
      node.destroy();
    }
    this.nodes.clear();
    
    for (const line of this.lines.values()) {
      line.destroy();
    }
    this.lines.clear();
    
    this.blueprint = null;
    this.selectedNodeId = null;
  }
  
  private centerCamera(nodes: BlueprintNode[]): void {
    if (nodes.length === 0) return;
    
    const bounds = this.layoutEngine.getBounds(nodes);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    
    this.cameras.main.centerOn(centerX, centerY);
  }
  
  getBlueprint(): Blueprint | null {
    return this.blueprint;
  }
  
  setOnNodeSelected(callback: (node: BlueprintNode) => void): void {
    this.onNodeSelected = callback;
  }

  resize(width: number, height: number): void {
    this.cameras.main.setSize(width, height);
  }
}
