import { TaskType } from '../stratix-ai-service/types';

export interface BlueprintNode {
  id: string;
  name: string;
  type: TaskType;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
  dependencies: string[];
}

export interface BlueprintEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

export interface Blueprint {
  id: string;
  projectId: string;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    strategy: string;
  };
}

export interface LayoutConfig {
  nodeWidth: number;
  nodeHeight: number;
  horizontalSpacing: number;
  verticalSpacing: number;
  startX: number;
  startY: number;
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  nodeWidth: 200,
  nodeHeight: 80,
  horizontalSpacing: 50,
  verticalSpacing: 100,
  startX: 100,
  startY: 100,
};
