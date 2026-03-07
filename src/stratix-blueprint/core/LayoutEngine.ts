import { BlueprintNode, BlueprintEdge, LayoutConfig, DEFAULT_LAYOUT_CONFIG } from '../types';
import { ParsedTask } from '../../stratix-ai-service/types';

export class LayoutEngine {
  private config: LayoutConfig;
  
  constructor(config?: Partial<LayoutConfig>) {
    this.config = { ...DEFAULT_LAYOUT_CONFIG, ...config };
  }
  
  layout(tasks: ParsedTask[]): { nodes: BlueprintNode[]; edges: BlueprintEdge[] } {
    // 1. Build dependency graph
    const layers = this.buildLayers(tasks);
    
    // 2. Calculate positions
    const nodes = this.calculatePositions(layers, tasks);
    
    // 3. Generate edges
    const edges = this.generateEdges(tasks);
    
    return { nodes, edges };
  }
  
  private buildLayers(tasks: ParsedTask[]): Map<number, string[]> {
    const layers = new Map<number, string[]>();
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const layerCache = new Map<string, number>();
    
    const getLayer = (taskId: string): number => {
      if (layerCache.has(taskId)) {
        return layerCache.get(taskId)!;
      }
      
      const task = taskMap.get(taskId);
      if (!task) return 0;
      
      if (task.dependencies.length === 0) {
        layerCache.set(taskId, 0);
        return 0;
      }
      
      const maxDepLayer = Math.max(
        ...task.dependencies.map(dep => getLayer(dep))
      );
      
      const layer = maxDepLayer + 1;
      layerCache.set(taskId, layer);
      return layer;
    };
    
    for (const task of tasks) {
      const layer = getLayer(task.id);
      if (!layers.has(layer)) {
        layers.set(layer, []);
      }
      layers.get(layer)!.push(task.id);
    }
    
    return layers;
  }
  
  private calculatePositions(
    layers: Map<number, string[]>,
    tasks: ParsedTask[]
  ): BlueprintNode[] {
    const nodes: BlueprintNode[] = [];
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    
    for (const [layerIndex, taskIds] of layers) {
      const y = this.config.startY + layerIndex * (this.config.nodeHeight + this.config.verticalSpacing);
      
      const totalWidth = taskIds.length * this.config.nodeWidth + 
                         (taskIds.length - 1) * this.config.horizontalSpacing;
      const startX = this.config.startX - totalWidth / 2 + this.config.nodeWidth / 2;
      
      taskIds.forEach((taskId, index) => {
        const task = taskMap.get(taskId);
        if (!task) return;
        
        const x = startX + index * (this.config.nodeWidth + this.config.horizontalSpacing);
        
        nodes.push({
          id: task.id,
          name: task.name,
          type: task.type,
          description: task.description,
          x,
          y,
          width: this.config.nodeWidth,
          height: this.config.nodeHeight,
          priority: task.priority,
          dependencies: task.dependencies,
        });
      });
    }
    
    return nodes;
  }
  
  private generateEdges(tasks: ParsedTask[]): BlueprintEdge[] {
    const edges: BlueprintEdge[] = [];
    
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        edges.push({
          id: `edge_${depId}_${task.id}`,
          fromNodeId: depId,
          toNodeId: task.id,
        });
      }
    }
    
    return edges;
  }
  
  updateNodePosition(nodes: BlueprintNode[], nodeId: string, x: number, y: number): BlueprintNode[] {
    return nodes.map(node => {
      if (node.id === nodeId) {
        return { ...node, x, y };
      }
      return node;
    });
  }
  
  getBounds(nodes: BlueprintNode[]): { minX: number; minY: number; maxX: number; maxY: number } {
    if (nodes.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    for (const node of nodes) {
      minX = Math.min(minX, node.x - node.width / 2);
      minY = Math.min(minY, node.y - node.height / 2);
      maxX = Math.max(maxX, node.x + node.width / 2);
      maxY = Math.max(maxY, node.y + node.height / 2);
    }
    
    return { minX, minY, maxX, maxY };
  }
}
