/**
 * SkillTreeUI - 技能树 UI 组件
 * 基于 Phaser DOM 的技能树可视化
 */

import { SkillTree } from '../core/SkillTree';
import { SKILL_CATEGORIES, ATTRIBUTE_LABELS } from '../config/skillTreeConfig';
import type { SkillNode } from '../types';

const THEME = {
  text: 'var(--ds-text-primary)',
  textMuted: 'var(--ds-text-muted)',
};

export interface SkillTreeUIConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  skillTree: SkillTree;
  onAttributesChange?: (attributes: Record<string, number>) => void;
}

export class SkillTreeUI {
  private scene: Phaser.Scene;
  private config: SkillTreeUIConfig;
  private container: Phaser.GameObjects.DOMElement | null = null;
  private skillTree: SkillTree;
  private currentAttributes: Record<string, number> = {};

  constructor(scene: Phaser.Scene, config: SkillTreeUIConfig) {
    this.scene = scene;
    this.config = config;
    this.skillTree = config.skillTree;

    this.skillTree.setOnStateChange((_state, attributes) => {
      this.currentAttributes = attributes;
      this.updateUI();
      if (this.config.onAttributesChange) {
        this.config.onAttributesChange(attributes);
      }
    });
  }

  create(): Phaser.GameObjects.DOMElement {
    const html = this.generateHTML();

    this.container = this.scene.add.dom(
      this.config.x,
      this.config.y
    ).createFromHTML(html);

    this.setupEventListeners();
    this.updateUI();

    return this.container;
  }

  private generateHTML(): string {
    const nodes = this.skillTree.getAllNodes();
    const nodeWidth = 80;
    const nodeHeight = 60;
    const spacing = 100;

    const nodesHtml = nodes.map(node => {
      const category = this.getNodeCategory(node) as keyof typeof SKILL_CATEGORIES;
      const categoryConfig = SKILL_CATEGORIES[category] ?? SKILL_CATEGORIES.utility;
      const x = node.position.x * spacing + 40;
      const y = node.position.y * spacing + 60;

      return `
        <div class="skill-node"
             data-node-id="${node.nodeId}"
             style="
               left: ${x}px;
               top: ${y}px;
               width: ${nodeWidth}px;
               height: ${nodeHeight}px;
               background: linear-gradient(135deg, ${categoryConfig.color}22, ${categoryConfig.color}44);
               border: 2px solid ${categoryConfig.color};
             ">
          <div class="node-icon">${categoryConfig.icon}</div>
          <div class="node-name">${node.name}</div>
        </div>
      `;
    }).join('');

    const connectionsHtml = this.generateConnections(nodes, spacing);

    return `
      <div class="skill-tree-ui" style="
        width: ${this.config.width}px;
        height: ${this.config.height}px;
        background: var(--ds-bg-secondary);
        border: 1px solid var(--ds-border);
        border-radius: 8px;
        overflow: hidden;
        font-family: system-ui, sans-serif;
        color: var(--ds-text-primary);
        display: flex;
        flex-direction: column;
        pointer-events: auto;
      ">
        <div class="header" style="
          padding: 10px;
          background: var(--ds-bg-tertiary);
          border-bottom: 1px solid var(--ds-border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <span style="font-size: 14px; font-weight: bold;">技能树</span>
          <span class="points-info" style="font-size: 12px; color: var(--ds-text-muted);">
            可用点数: <span class="remaining-points">${this.skillTree.getRemainingPoints()}</span>/${this.skillTree.getMaxPoints()}
          </span>
        </div>
        <div class="tree-content" style="
          flex: 1;
          position: relative;
          overflow: auto;
          padding: 20px;
        ">
          <svg class="connections" style="
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
          ">
            ${connectionsHtml}
          </svg>
          ${nodesHtml}
        </div>
        <div class="attributes-panel" style="
          padding: 10px;
          background: var(--ds-bg-tertiary);
          border-top: 1px solid var(--ds-border);
          max-height: 80px;
          overflow-y: auto;
        ">
          <div class="attributes-list" style="display: flex; flex-wrap: wrap; gap: 8px;">
            ${this.generateAttributesHtml()}
          </div>
        </div>
      </div>
      <style>
        .skill-node {
          position: absolute;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
          user-select: none;
        }
        .skill-node:hover {
          transform: scale(1.05);
          box-shadow: 0 0 15px currentColor;
        }
        .skill-node.selected {
          box-shadow: 0 0 10px var(--ds-status-success);
          border-color: var(--ds-status-success) !important;
        }
        .skill-node.locked {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .skill-node.locked:hover {
          transform: none;
          box-shadow: none;
        }
        .node-icon {
          font-size: 16px;
          margin-bottom: 2px;
        }
        .node-name {
          font-size: 10px;
          text-align: center;
          line-height: 1.2;
        }
        .connection-line {
          stroke: var(--ds-border);
          stroke-width: 2;
        }
        .connection-line.active {
          stroke: var(--ds-status-success);
        }
        .attr-item {
          padding: 4px 8px;
          background: var(--ds-bg-tertiary);
          border-radius: 4px;
          font-size: 11px;
        }
        .attr-name {
          color: ${THEME.textMuted};
        }
        .attr-value {
          color: var(--ds-status-success);
          font-weight: bold;
          margin-left: 4px;
        }
      </style>
    `;
  }

  private generateConnections(nodes: SkillNode[], spacing: number): string {
    const lines: string[] = [];

    for (const node of nodes) {
      for (const prereqId of node.prerequisites) {
        const prereq = this.skillTree.getNode(prereqId);
        if (!prereq) continue;

        const x1 = prereq.position.x * spacing + 80;
        const y1 = prereq.position.y * spacing + 90;
        const x2 = node.position.x * spacing + 80;
        const y2 = node.position.y * spacing + 60;

        lines.push(
          `<line class="connection-line" data-from="${prereqId}" data-to="${node.nodeId}"
                 x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`
        );
      }
    }

    return lines.join('');
  }

  private generateAttributesHtml(): string {
    if (Object.keys(this.currentAttributes).length === 0) {
      return `<span style="color: ${THEME.textMuted}; font-size: 12px;">选择技能节点以查看属性加成</span>`;
    }

    return Object.entries(this.currentAttributes)
      .map(([attr, value]) => {
        const label = ATTRIBUTE_LABELS[attr] ?? attr;
        const displayValue = attr.includes('Chance') || attr.includes('Damage')
          ? `${value}%`
          : `+${value}`;
        return `
          <div class="attr-item">
            <span class="attr-name">${label}</span>
            <span class="attr-value">${displayValue}</span>
          </div>
        `;
      }).join('');
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;

    // 阻止所有点击事件冒泡到 canvas
    node.addEventListener('click', (e) => e.stopPropagation());
    node.addEventListener('pointerdown', (e) => e.stopPropagation());
    node.addEventListener('pointerup', (e) => e.stopPropagation());
    node.addEventListener('pointermove', (e) => e.stopPropagation());

    node.querySelectorAll('.skill-node').forEach(nodeEl => {
      nodeEl.addEventListener('click', (e) => {
        const nodeId = (e.currentTarget as HTMLElement).dataset.nodeId;
        if (!nodeId) return;

        const { canSelect, reason } = this.skillTree.canSelectNode(nodeId);

        if (this.skillTree.isNodeSelected(nodeId)) {
          this.skillTree.deselectNode(nodeId);
        } else if (canSelect) {
          this.skillTree.selectNode(nodeId);
        } else {
          this.showMessage(reason ?? '无法选择');
        }
      });

      nodeEl.addEventListener('mouseenter', (e) => {
        const nodeId = (e.currentTarget as HTMLElement).dataset.nodeId;
        const nodeData = this.skillTree.getNode(nodeId!);
        if (nodeData) {
          this.showTooltip(nodeData, e as MouseEvent);
        }
      });

      nodeEl.addEventListener('mouseleave', () => {
        this.hideTooltip();
      });
    });
  }

  private updateUI(): void {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;

    node.querySelectorAll('.skill-node').forEach(nodeEl => {
      const nodeId = (nodeEl as HTMLElement).dataset.nodeId;
      if (!nodeId) return;

      const isSelected = this.skillTree.isNodeSelected(nodeId);
      const isUnlocked = this.skillTree.isNodeUnlocked(nodeId);

      nodeEl.classList.toggle('selected', isSelected);
      nodeEl.classList.toggle('locked', !isUnlocked);
    });

    node.querySelectorAll('.connection-line').forEach(line => {
      const fromId = (line as SVGLineElement).dataset.from;
      const toId = (line as SVGLineElement).dataset.to;

      const fromSelected = this.skillTree.isNodeSelected(fromId!);
      const toSelected = this.skillTree.isNodeSelected(toId!);

      line.classList.toggle('active', fromSelected && toSelected);
    });

    const remainingEl = node.querySelector('.remaining-points');
    if (remainingEl) {
      remainingEl.textContent = this.skillTree.getRemainingPoints().toString();
    }

    const attrsList = node.querySelector('.attributes-list');
    if (attrsList) {
      attrsList.innerHTML = this.generateAttributesHtml();
    }
  }

  private showTooltip(skill: SkillNode, event: MouseEvent): void {
    this.hideTooltip();

    const tooltip = document.createElement('div');
    tooltip.className = 'skill-tooltip';
    tooltip.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 4px;">${skill.name}</div>
      <div style="font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">${skill.description}</div>
      <div style="font-size: 10px; color: var(--ds-status-success);">
        ${Object.entries(skill.attributes).map(([k, v]) => `${ATTRIBUTE_LABELS[k] ?? k}: +${v}`).join(' | ')}
      </div>
    `;
    tooltip.style.cssText = `
      position: fixed;
      left: ${event.clientX + 10}px;
      top: ${event.clientY + 10}px;
      background: var(--ds-bg-tertiary);
      border: 1px solid var(--ds-border);
      border-radius: 6px;
      padding: 10px;
      font-size: 12px;
      color: ${THEME.text};
      z-index: 10000;
      max-width: 200px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;

    document.body.appendChild(tooltip);
  }

  private hideTooltip(): void {
    document.querySelectorAll('.skill-tooltip').forEach(el => el.remove());
  }

  private showMessage(text: string): void {
    console.log('[SkillTree]', text);
  }

  private getNodeCategory(node: SkillNode): string {
    const attrs = Object.keys(node.attributes);
    if (attrs.some(a => a.includes('attack') || a.includes('damage'))) return 'combat';
    if (attrs.some(a => a.includes('defense') || a.includes('armor') || a.includes('block'))) return 'defense';
    if (attrs.some(a => a.includes('speed') || a.includes('dodge'))) return 'mobility';
    if (attrs.some(a => a.includes('mana') || a.includes('magic'))) return 'magic';
    return 'utility';
  }

  getSkillTree(): SkillTree {
    return this.skillTree;
  }

  setVisible(visible: boolean): void {
    if (this.container) {
      this.container.setVisible(visible);
    }
  }

  destroy(): void {
    this.hideTooltip();
    this.container?.destroy();
  }
}
