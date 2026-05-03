/**
 * SkillTree - 技能树核心逻辑
 * 管理技能节点、前置条件、属性计算
 */

import type { SkillNode, SkillTreeState } from '../types';

export interface SkillTreeConfig {
  nodes: SkillNode[];
  maxPoints?: number;
}

class SkillTree {
  private nodes: Map<string, SkillNode> = new Map();
  private state: SkillTreeState;
  private maxPoints: number;
  private onStateChange?: (state: SkillTreeState, attributes: Record<string, number>) => void;

  constructor(config: SkillTreeConfig) {
    this.maxPoints = config.maxPoints ?? 10;
    this.state = {
      selectedNodes: [],
      unlockedNodes: []
    };

    for (const node of config.nodes) {
      this.nodes.set(node.nodeId, node);
    }

    this.initializeUnlockedNodes();
  }

  private initializeUnlockedNodes(): void {
    for (const [nodeId, node] of this.nodes) {
      if (node.prerequisites.length === 0) {
        if (!this.state.unlockedNodes.includes(nodeId)) {
          this.state.unlockedNodes.push(nodeId);
        }
      }
    }
  }

  getNode(nodeId: string): SkillNode | undefined {
    return this.nodes.get(nodeId);
  }

  getAllNodes(): SkillNode[] {
    return Array.from(this.nodes.values());
  }

  isNodeUnlocked(nodeId: string): boolean {
    return this.state.unlockedNodes.includes(nodeId);
  }

  isNodeSelected(nodeId: string): boolean {
    return this.state.selectedNodes.includes(nodeId);
  }

  canSelectNode(nodeId: string): { canSelect: boolean; reason?: string } {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return { canSelect: false, reason: '节点不存在' };
    }

    if (this.isNodeSelected(nodeId)) {
      return { canSelect: false, reason: '已选择该节点' };
    }

    for (const prereq of node.prerequisites) {
      if (!this.isNodeSelected(prereq)) {
        return { canSelect: false, reason: '前置条件未满足' };
      }
    }

    if (this.state.selectedNodes.length >= this.maxPoints) {
      return { canSelect: false, reason: '技能点已用完' };
    }

    return { canSelect: true };
  }

  selectNode(nodeId: string): boolean {
    const { canSelect } = this.canSelectNode(nodeId);
    if (!canSelect) return false;

    this.state.selectedNodes.push(nodeId);
    this.updateUnlockedNodes();
    this.notifyStateChange();

    return true;
  }

  deselectNode(nodeId: string): boolean {
    if (!this.isNodeSelected(nodeId)) return false;

    for (const [id, node] of this.nodes) {
      if (node.prerequisites.includes(nodeId) && this.isNodeSelected(id)) {
        this.deselectNode(id);
      }
    }

    const index = this.state.selectedNodes.indexOf(nodeId);
    if (index > -1) {
      this.state.selectedNodes.splice(index, 1);
    }

    this.updateUnlockedNodes();
    this.notifyStateChange();

    return true;
  }

  toggleNode(nodeId: string): boolean {
    if (this.isNodeSelected(nodeId)) {
      return this.deselectNode(nodeId);
    } else {
      return this.selectNode(nodeId);
    }
  }

  private updateUnlockedNodes(): void {
    this.state.unlockedNodes = [];

    for (const [nodeId, node] of this.nodes) {
      if (node.prerequisites.length === 0) {
        this.state.unlockedNodes.push(nodeId);
        continue;
      }

      const allPrereqsMet = node.prerequisites.every(prereq => {
        const prereqNode = this.nodes.get(prereq);
        return this.isNodeSelected(prereq) || (prereqNode?.prerequisites.length === 0);
      });

      if (allPrereqsMet) {
        this.state.unlockedNodes.push(nodeId);
      }
    }
  }

  calculateAttributes(): Record<string, number> {
    const attributes: Record<string, number> = {};

    for (const nodeId of this.state.selectedNodes) {
      const node = this.nodes.get(nodeId);
      if (!node) continue;

      for (const [attr, value] of Object.entries(node.attributes)) {
        attributes[attr] = (attributes[attr] ?? 0) + value;
      }
    }

    return attributes;
  }

  getState(): SkillTreeState {
    return {
      selectedNodes: [...this.state.selectedNodes],
      unlockedNodes: [...this.state.unlockedNodes]
    };
  }

  setState(state: SkillTreeState): void {
    this.state = {
      selectedNodes: [...state.selectedNodes],
      unlockedNodes: [...state.unlockedNodes]
    };
    this.updateUnlockedNodes();
    this.notifyStateChange();
  }

  reset(): void {
    this.state = {
      selectedNodes: [],
      unlockedNodes: []
    };
    this.initializeUnlockedNodes();
    this.notifyStateChange();
  }

  getSelectedCount(): number {
    return this.state.selectedNodes.length;
  }

  getMaxPoints(): number {
    return this.maxPoints;
  }

  getRemainingPoints(): number {
    return this.maxPoints - this.state.selectedNodes.length;
  }

  setOnStateChange(callback: (state: SkillTreeState, attributes: Record<string, number>) => void): void {
    this.onStateChange = callback;
  }

  private notifyStateChange(): void {
    if (this.onStateChange) {
      this.onStateChange(this.getState(), this.calculateAttributes());
    }
  }

  getNodesByCategory(): Record<string, SkillNode[]> {
    const categories: Record<string, SkillNode[]> = {};

    for (const node of this.nodes.values()) {
      const category = this.getNodeCategory(node);
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(node);
    }

    return categories;
  }

  private getNodeCategory(node: SkillNode): string {
    const attrs = Object.keys(node.attributes);
    if (attrs.includes('attack') || attrs.includes('damage')) return 'combat';
    if (attrs.includes('defense') || attrs.includes('armor')) return 'defense';
    if (attrs.includes('speed') || attrs.includes('agility')) return 'mobility';
    if (attrs.includes('mana') || attrs.includes('magic')) return 'magic';
    return 'utility';
  }
}

export { SkillTree };
export default SkillTree;
