/**
 * WorkflowCanvas - Drag-and-drop node-based workflow editor
 *
 * Features:
 * - Left panel with draggable agent items
 * - Canvas with pan (middle mouse / space+drag) and zoom (scroll)
 * - Nodes with input/output ports
 * - SVG connections with valid/invalid target feedback
 * - Delete via right-click menu or Delete key
 */

import { providerRegistry } from '@/agent-platform/providers/registry';
import type { WorkflowStep, WorkflowDefinition } from '@/agent-platform/workflow/types';
import { getLightweightAgencyTemplates, getDomainDisplayName } from '@/stratix-character-creator/config/agencyAgents';
import type { LightweightSoulTemplate } from '@/stratix-character-creator/config/agencyAgents';

const THEME = {
  bg: '#1a1a2e',
  bgSecondary: '#16213e',
  border: '#0f3460',
  accent: '#e94560',
  text: '#eaeaea',
  textMuted: '#8b8b8b',
  inputBg: '#0f3460',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  nodeBg: '#1e2a4a',
  nodeBorder: '#2a3f6f',
  portInput: '#4a9eff',
  portOutput: '#ff6b6b',
  connectionValid: '#22c55e',
  connectionInvalid: '#ef4444',
  connectionDefault: '#8b8b8b',
};

export interface CanvasNode {
  id: string;
  type: 'agent' | 'llm' | 'condition' | 'delay' | 'router' | 'start' | 'end';
  name: string;
  x: number;
  y: number;
  properties: Record<string, unknown>;
  inputs: string[];
  outputs: string[];
}

export interface CanvasConnection {
  id: string;
  fromNodeId: string;
  fromPort: string;
  toNodeId: string;
  toPort: string;
}

export interface WorkflowCanvasConfig {
  width: number;
  height: number;
  initialDefinition?: WorkflowDefinition;
  onChange?: (definition: WorkflowDefinition) => void;
}

const NODE_WIDTH = 200;
const NODE_HEADER_HEIGHT = 36;
const PORT_SIZE = 12;
const PORT_RADIUS = 6;

export class WorkflowCanvas {
  private container: HTMLDivElement | null = null;
  private config: WorkflowCanvasConfig;
  private nodes: Map<string, CanvasNode> = new Map();
  private connections: Map<string, CanvasConnection> = new Map();
  private selectedNodeId: string | null = null;
  private selectedConnectionId: string | null = null;

  // Pan and zoom state
  private panX = 0;
  private panY = 0;
  private zoom = 1;
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private spacePressed = false;

  // Connection drawing state
  private isDrawingConnection = false;
  private connectionStartNode: string | null = null;
  private connectionStartPort: string | null = null;
  private tempConnectionEnd: { x: number; y: number } | null = null;

  // Dragging state
  private draggedNode: CanvasNode | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  // DOM elements
  private palette: HTMLDivElement | null = null;
  private canvas: HTMLDivElement | null = null;
  private svgLayer: SVGSVGElement | null = null;
  private nodesLayer: HTMLDivElement | null = null;
  private contextMenu: HTMLDivElement | null = null;

  constructor(config: WorkflowCanvasConfig) {
    this.config = config;
  }

  create(parent: HTMLElement): HTMLDivElement {
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: ${this.config.width}px;
      height: ${this.config.height}px;
      background: ${THEME.bg};
      border-radius: 8px;
      overflow: hidden;
      display: flex;
    `;

    // Create palette (left panel)
    this.palette = this.createPalette();
    this.container.appendChild(this.palette);

    // Create canvas area
    const canvasArea = document.createElement('div');
    canvasArea.style.cssText = `
      flex: 1;
      position: relative;
      overflow: hidden;
    `;
    this.container.appendChild(canvasArea);

    // SVG layer for connections
    this.svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svgLayer.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    `;
    this.svgLayer.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    canvasArea.appendChild(this.svgLayer);

    // Nodes layer
    this.nodesLayer = document.createElement('div');
    this.nodesLayer.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      transform-origin: 0 0;
    `;
    canvasArea.appendChild(this.nodesLayer);

    this.canvas = canvasArea;

    // Create context menu
    this.contextMenu = this.createContextMenu();
    this.container.appendChild(this.contextMenu);

    // Setup event listeners
    this.setupCanvasEvents(canvasArea);
    this.setupKeyboardEvents();

    // Add initial nodes if definition provided
    if (this.config.initialDefinition) {
      this.loadFromDefinition(this.config.initialDefinition);
    } else {
      this.addInitialNodes();
    }

    parent.appendChild(this.container);
    return this.container;
  }

  private createPalette(): HTMLDivElement {
    const palette = document.createElement('div');
    palette.style.cssText = `
      width: 220px;
      background: ${THEME.bgSecondary};
      border-right: 1px solid ${THEME.border};
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      padding: 12px;
      border-bottom: 1px solid ${THEME.border};
      color: ${THEME.text};
      font-size: 12px;
      font-weight: 500;
    `;
    header.textContent = '📦 Agent 节点';
    palette.appendChild(header);

    // Agents from agency-agents
    const agents = getLightweightAgencyTemplates().slice(0, 12);

    const agentsSection = document.createElement('div');
    agentsSection.style.cssText = `
      padding: 8px;
    `;

    const sectionTitle = document.createElement('div');
    sectionTitle.style.cssText = `
      color: ${THEME.textMuted};
      font-size: 10px;
      text-transform: uppercase;
      margin-bottom: 8px;
      padding-left: 4px;
    `;
    sectionTitle.textContent = '拖拽到画布';
    agentsSection.appendChild(sectionTitle);

    for (const agent of agents) {
      const item = this.createPaletteItem(agent);
      agentsSection.appendChild(item);
    }

    palette.appendChild(agentsSection);

    // LLM Nodes section
    const llmSection = document.createElement('div');
    llmSection.style.cssText = `
      padding: 8px;
      border-top: 1px solid ${THEME.border};
    `;

    const llmTitle = document.createElement('div');
    llmTitle.style.cssText = `
      color: ${THEME.textMuted};
      font-size: 10px;
      text-transform: uppercase;
      margin-bottom: 8px;
      padding-left: 4px;
    `;
    llmTitle.textContent = 'LLM 节点';
    llmSection.appendChild(llmTitle);

    const providers = providerRegistry.getAllConfigs().slice(0, 4);
    for (const provider of providers) {
      const item = document.createElement('div');
      item.draggable = true;
      item.style.cssText = `
        padding: 8px;
        margin-bottom: 4px;
        background: ${THEME.nodeBg};
        border: 1px solid ${THEME.nodeBorder};
        border-radius: 6px;
        cursor: grab;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: all 0.15s;
      `;
      item.innerHTML = `
        <span style="font-size: 16px;">${provider.icon}</span>
        <span style="color: ${THEME.text}; font-size: 12px;">${provider.name}</span>
      `;

      item.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('application/node-type', 'llm');
        e.dataTransfer?.setData('application/provider-id', provider.id);
        e.dataTransfer?.setData('application/provider-name', provider.name);
        e.dataTransfer?.setData('application/provider-icon', provider.icon);
      });

      item.addEventListener('mouseenter', () => {
        item.style.borderColor = THEME.accent;
        item.style.transform = 'translateX(2px)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.borderColor = THEME.nodeBorder;
        item.style.transform = 'translateX(0)';
      });

      llmSection.appendChild(item);
    }

    palette.appendChild(llmSection);

    // Control flow section
    const controlSection = document.createElement('div');
    controlSection.style.cssText = `
      padding: 8px;
      border-top: 1px solid ${THEME.border};
    `;

    const controlTitle = document.createElement('div');
    controlTitle.style.cssText = `
      color: ${THEME.textMuted};
      font-size: 10px;
      text-transform: uppercase;
      margin-bottom: 8px;
      padding-left: 4px;
    `;
    controlTitle.textContent = '控制流';
    controlSection.appendChild(controlTitle);

    const controls = [
      { type: 'condition', icon: '🔀', name: '条件判断' },
      { type: 'delay', icon: '⏱', name: '延迟节点' },
      { type: 'router', icon: '🔀', name: '条件路由' },
    ];

    for (const ctrl of controls) {
      const item = document.createElement('div');
      item.draggable = true;
      item.style.cssText = `
        padding: 8px;
        margin-bottom: 4px;
        background: ${THEME.nodeBg};
        border: 1px solid ${THEME.nodeBorder};
        border-radius: 6px;
        cursor: grab;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: all 0.15s;
      `;
      item.innerHTML = `
        <span style="font-size: 16px;">${ctrl.icon}</span>
        <span style="color: ${THEME.text}; font-size: 12px;">${ctrl.name}</span>
      `;

      item.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('application/node-type', ctrl.type);
      });

      item.addEventListener('mouseenter', () => {
        item.style.borderColor = THEME.accent;
        item.style.transform = 'translateX(2px)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.borderColor = THEME.nodeBorder;
        item.style.transform = 'translateX(0)';
      });

      controlSection.appendChild(item);
    }

    palette.appendChild(controlSection);

    return palette;
  }

  private createPaletteItem(agent: LightweightSoulTemplate): HTMLDivElement {
    const item = document.createElement('div');
    item.draggable = true;
    item.style.cssText = `
      padding: 8px;
      margin-bottom: 4px;
      background: ${THEME.nodeBg};
      border: 1px solid ${THEME.nodeBorder};
      border-radius: 6px;
      cursor: grab;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s;
    `;
    item.innerHTML = `
      <span style="font-size: 16px;">${agent.emoji}</span>
      <div>
        <div style="color: ${THEME.text}; font-size: 12px;">${agent.name.replace(/^[^\s]+\s/, '')}</div>
        <div style="color: ${THEME.textMuted}; font-size: 10px;">${getDomainDisplayName(agent.domain)}</div>
      </div>
    `;

    item.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('application/node-type', 'agent');
      e.dataTransfer?.setData('application/agent-id', agent.id);
      e.dataTransfer?.setData('application/agent-name', agent.name);
      e.dataTransfer?.setData('application/agent-emoji', agent.emoji);
    });

    item.addEventListener('mouseenter', () => {
      item.style.borderColor = THEME.accent;
      item.style.transform = 'translateX(2px)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.borderColor = THEME.nodeBorder;
      item.style.transform = 'translateX(0)';
    });

    return item;
  }

  private createContextMenu(): HTMLDivElement {
    const menu = document.createElement('div');
    menu.style.cssText = `
      position: fixed;
      background: ${THEME.bgSecondary};
      border: 1px solid ${THEME.border};
      border-radius: 6px;
      padding: 4px 0;
      min-width: 120px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      display: none;
      z-index: 1000;
    `;

    const deleteItem = document.createElement('div');
    deleteItem.style.cssText = `
      padding: 8px 12px;
      color: ${THEME.error};
      font-size: 12px;
      cursor: pointer;
    `;
    deleteItem.textContent = '🗑 删除';
    deleteItem.addEventListener('click', () => this.deleteSelected());
    menu.appendChild(deleteItem);

    return menu;
  }

  private setupCanvasEvents(canvas: HTMLDivElement): void {
    // Drop event for creating nodes
    canvas.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    });

    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const nodeType = e.dataTransfer?.getData('application/node-type');
      if (!nodeType) return;

      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - this.panX) / this.zoom;
      const y = (e.clientY - rect.top - this.panY) / this.zoom;

      let node: CanvasNode;

      if (nodeType === 'agent') {
        const agentId = e.dataTransfer?.getData('application/agent-id') || 'unknown';
        const agentName = e.dataTransfer?.getData('application/agent-name') || 'Agent';
        const agentEmoji = e.dataTransfer?.getData('application/agent-emoji') || '🤖';
        node = this.createAgentNode(agentId, agentName, agentEmoji, x, y);
      } else if (nodeType === 'llm') {
        const providerId = e.dataTransfer?.getData('application/provider-id') || 'openai';
        const providerName = e.dataTransfer?.getData('application/provider-name') || 'LLM';
        const providerIcon = e.dataTransfer?.getData('application/provider-icon') || '💬';
        node = this.createLLMNode(providerId, providerName, providerIcon, x, y);
      } else {
        node = this.createControlNode(nodeType, x, y);
      }

      this.addNode(node);
    });

    // Pan events
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1 || (e.button === 0 && this.spacePressed)) {
        this.isPanning = true;
        this.panStartX = e.clientX - this.panX;
        this.panStartY = e.clientY - this.panY;
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
      } else if (e.button === 0 && e.target === canvas) {
        // Click on canvas background - deselect
        this.selectedNodeId = null;
        this.selectedConnectionId = null;
        this.updateSelection();
        this.hideContextMenu();
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.panStartX;
        this.panY = e.clientY - this.panStartY;
        this.updateTransform();
      } else if (this.isDrawingConnection && this.connectionStartNode) {
        const rect = canvas.getBoundingClientRect();
        this.tempConnectionEnd = {
          x: (e.clientX - rect.left - this.panX) / this.zoom,
          y: (e.clientY - rect.top - this.panY) / this.zoom,
        };
        this.renderConnections();
      } else if (this.draggedNode) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - this.panX) / this.zoom - this.dragOffsetX;
        const y = (e.clientY - rect.top - this.panY) / this.zoom - this.dragOffsetY;
        this.draggedNode.x = x;
        this.draggedNode.y = y;
        this.updateNodePosition(this.draggedNode);
        this.renderConnections();
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      if (this.isPanning) {
        this.isPanning = false;
        canvas.style.cursor = this.spacePressed ? 'grab' : 'default';
      }
      if (this.isDrawingConnection) {
        this.isDrawingConnection = false;
        this.connectionStartNode = null;
        this.connectionStartPort = null;
        this.tempConnectionEnd = null;
        this.renderConnections();
      }
      if (this.draggedNode) {
        this.draggedNode = null;
      }
    });

    // Zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(Math.max(this.zoom * delta, 0.25), 3);
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
      this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
      this.zoom = newZoom;

      this.updateTransform();
    }, { passive: false });

    // Context menu
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e.clientX, e.clientY);
    });

    canvas.addEventListener('click', () => {
      this.hideContextMenu();
    });
  }

  private setupKeyboardEvents(): void {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.spacePressed) {
        this.spacePressed = true;
        if (this.canvas) {
          this.canvas.style.cursor = 'grab';
        }
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (this.selectedNodeId || this.selectedConnectionId) {
          this.deleteSelected();
        }
      } else if (e.code === 'Escape') {
        this.selectedNodeId = null;
        this.selectedConnectionId = null;
        this.updateSelection();
        this.hideContextMenu();
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spacePressed = false;
        if (this.canvas && !this.isPanning) {
          this.canvas.style.cursor = 'default';
        }
      }
    });
  }

  private createAgentNode(id: string, name: string, emoji: string, x: number, y: number): CanvasNode {
    return {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'agent',
      name: `${emoji} ${name.replace(/^[^\s]+\s/, '')}`,
      x,
      y,
      properties: { agentId: id, agentType: 'assistant' },
      inputs: ['trigger'],
      outputs: ['next'],
    };
  }

  private createLLMNode(providerId: string, name: string, icon: string, x: number, y: number): CanvasNode {
    return {
      id: `llm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: 'llm',
      name: `${icon} ${name}`,
      x,
      y,
      properties: { providerId, model: providerRegistry.getModels(providerId)[0] || '' },
      inputs: ['input'],
      outputs: ['output'],
    };
  }

  private createControlNode(type: string, x: number, y: number): CanvasNode {
    const configs: Record<string, { name: string; icon: string; inputs: string[]; outputs: string[]; properties?: Record<string, unknown> }> = {
      condition: { name: '🔀 条件判断', icon: '🔀', inputs: ['input'], outputs: ['true', 'false'] },
      delay: { name: '⏱ 延迟', icon: '⏱', inputs: ['in'], outputs: ['out'], properties: { delayDuration: 1000 } },
      router: { name: '🔀 条件路由', icon: '🔀', inputs: ['input'], outputs: ['case1', 'case2', 'default'] },
    };

    const config = configs[type] || { name: '❓ 节点', icon: '❓', inputs: ['in'], outputs: ['out'] };

    return {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: type as CanvasNode['type'],
      name: config.name,
      x,
      y,
      properties: config.properties || {},
      inputs: config.inputs,
      outputs: config.outputs,
    };
  }

  private addNode(node: CanvasNode): void {
    this.nodes.set(node.id, node);
    this.renderNode(node);
    this.renderConnections();
    this.notifyChange();
  }

  private renderNode(node: CanvasNode): void {
    if (!this.nodesLayer) return;

    const existing = this.nodesLayer.querySelector(`[data-node-id="${node.id}"]`);
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.dataset.nodeId = node.id;
    el.style.cssText = `
      position: absolute;
      left: ${node.x}px;
      top: ${node.y}px;
      width: ${NODE_WIDTH}px;
      background: ${THEME.nodeBg};
      border: 2px solid ${THEME.nodeBorder};
      border-radius: 8px;
      overflow: visible;
      cursor: move;
      user-select: none;
      transition: box-shadow 0.15s, border-color 0.15s;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 8px 12px;
      background: ${THEME.bgSecondary};
      border-bottom: 1px solid ${THEME.border};
      border-radius: 6px 6px 0 0;
      color: ${THEME.text};
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;
    header.textContent = node.name;
    el.appendChild(header);

    // Ports container
    const portsContainer = document.createElement('div');
    portsContainer.style.cssText = `
      position: relative;
      height: 24px;
    `;

    // Input ports
    for (let i = 0; i < node.inputs.length; i++) {
      const port = document.createElement('div');
      const portIndex = node.inputs.length > 1 ? i + 1 : 0;
      port.style.cssText = `
        position: absolute;
        left: -${PORT_SIZE / 2}px;
        top: ${12 + portIndex * 20}px;
        width: ${PORT_SIZE}px;
        height: ${PORT_SIZE}px;
        background: ${THEME.portInput};
        border: 2px solid ${THEME.nodeBg};
        border-radius: 50%;
        cursor: crosshair;
        z-index: 1;
      `;
      port.dataset.portType = 'input';
      port.dataset.portName = node.inputs[i];

      port.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.startConnection(node.id, node.inputs[i], e);
      });

      port.addEventListener('mouseup', (e) => {
        e.stopPropagation();
        this.finishConnection(node.id, node.inputs[i]);
      });

      portsContainer.appendChild(port);
    }

    // Output ports
    for (let i = 0; i < node.outputs.length; i++) {
      const port = document.createElement('div');
      const portIndex = node.outputs.length > 1 ? i + 1 : 0;
      port.style.cssText = `
        position: absolute;
        right: -${PORT_SIZE / 2}px;
        top: ${12 + portIndex * 20}px;
        width: ${PORT_SIZE}px;
        height: ${PORT_SIZE}px;
        background: ${THEME.portOutput};
        border: 2px solid ${THEME.nodeBg};
        border-radius: 50%;
        cursor: crosshair;
        z-index: 1;
      `;
      port.dataset.portType = 'output';
      port.dataset.portName = node.outputs[i];

      port.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.startConnection(node.id, node.outputs[i], e);
      });

      port.addEventListener('mouseup', (e) => {
        e.stopPropagation();
        this.finishConnection(node.id, node.outputs[i]);
      });

      portsContainer.appendChild(port);
    }

    el.appendChild(portsContainer);

    // Node events
    el.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).dataset.portType) return;
      e.stopPropagation();
      this.selectNode(node.id);

      this.draggedNode = node;
      const rect = this.nodesLayer!.getBoundingClientRect();
      this.dragOffsetX = (e.clientX - rect.left - this.panX) / this.zoom - node.x;
      this.dragOffsetY = (e.clientY - rect.top - this.panY) / this.zoom - node.y;
    });

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectNode(node.id);
    });

    el.addEventListener('contextmenu', (e) => {
      e.stopPropagation();
      this.selectNode(node.id);
      this.showContextMenu(e.clientX, e.clientY);
    });

    this.nodesLayer.appendChild(el);
  }

  private updateNodePosition(node: CanvasNode): void {
    const el = this.nodesLayer?.querySelector(`[data-node-id="${node.id}"]`) as HTMLDivElement;
    if (el) {
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
    }
  }

  private startConnection(nodeId: string, portName: string, e: MouseEvent): void {
    this.isDrawingConnection = true;
    this.connectionStartNode = nodeId;
    this.connectionStartPort = portName;

    if (this.canvas) {
      const rect = this.canvas.getBoundingClientRect();
      this.tempConnectionEnd = {
        x: (e.clientX - rect.left - this.panX) / this.zoom,
        y: (e.clientY - rect.top - this.panY) / this.zoom,
      };
    }
  }

  private finishConnection(toNodeId: string, toPort: string): void {
    if (!this.isDrawingConnection || !this.connectionStartNode || !this.connectionStartPort) return;

    // Don't connect to self
    if (this.connectionStartNode === toNodeId) return;

    // Check if connection already exists
    const exists = Array.from(this.connections.values()).some(
      (c) => c.fromNodeId === this.connectionStartNode && c.toNodeId === toNodeId
    );
    if (exists) return;

    const connection: CanvasConnection = {
      id: `conn-${Date.now()}`,
      fromNodeId: this.connectionStartNode,
      fromPort: this.connectionStartPort,
      toNodeId,
      toPort,
    };

    this.connections.set(connection.id, connection);
    this.renderConnections();
    this.notifyChange();
  }

  private renderConnections(): void {
    if (!this.svgLayer) return;

    // Clear existing paths
    while (this.svgLayer.firstChild) {
      this.svgLayer.removeChild(this.svgLayer.firstChild);
    }

    const transform = `translate(${this.panX}, ${this.panY}) scale(${this.zoom})`;

    // Render established connections
    for (const conn of this.connections.values()) {
      const fromNode = this.nodes.get(conn.fromNodeId);
      const toNode = this.nodes.get(conn.toNodeId);
      if (!fromNode || !toNode) continue;

      const fromPortIndex = fromNode.outputs.indexOf(conn.fromPort);
      const toPortIndex = toNode.inputs.indexOf(conn.toPort);

      const fromX = fromNode.x + NODE_WIDTH + PORT_SIZE / 2;
      const fromY = fromNode.y + NODE_HEADER_HEIGHT + 12 + (fromPortIndex + 1) * 20;

      const toX = toNode.x - PORT_SIZE / 2;
      const toY = toNode.y + NODE_HEADER_HEIGHT + 12 + (toPortIndex + 1) * 20;

      const isSelected = conn.id === this.selectedConnectionId;

      this.drawConnection(fromX, fromY, toX, toY, isSelected ? THEME.accent : THEME.connectionDefault, transform, conn.id);
    }

    // Render temp connection while drawing
    if (this.isDrawingConnection && this.connectionStartNode && this.tempConnectionEnd) {
      const fromNode = this.nodes.get(this.connectionStartNode);
      if (fromNode) {
        const fromPortIndex = fromNode.outputs.indexOf(this.connectionStartPort || 'next');

        const fromX = fromNode.x + NODE_WIDTH + PORT_SIZE / 2;
        const fromY = fromNode.y + NODE_HEADER_HEIGHT + 12 + (fromPortIndex + 1) * 20;

        const toX = this.tempConnectionEnd.x;
        const toY = this.tempConnectionEnd.y;

        // Determine if target is valid
        const targetNodeId = this.findNodeAtPosition(toX, toY);
        const isValid = targetNodeId && targetNodeId !== this.connectionStartNode;

        this.drawConnection(fromX, fromY, toX, toY, isValid ? THEME.connectionValid : THEME.connectionInvalid, transform);
      }
    }
  }

  private drawConnection(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    transform: string,
    connId?: string
  ): void {
    if (!this.svgLayer) return;

    // Bezier curve
    const midX = (x1 + x2) / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    path.setAttribute('d', d);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    path.setAttribute('transform', transform);

    if (connId) {
      path.dataset.connId = connId;
      path.style.pointerEvents = 'stroke';
      path.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectConnection(connId);
      });
      path.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectConnection(connId);
        this.showContextMenu(e.clientX, e.clientY);
      });
    }

    this.svgLayer.appendChild(path);

    // Arrow head
    const arrowSize = 8;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const ax1 = x2 - arrowSize * Math.cos(angle - Math.PI / 6);
    const ay1 = y2 - arrowSize * Math.sin(angle - Math.PI / 6);
    const ax2 = x2 - arrowSize * Math.cos(angle + Math.PI / 6);
    const ay2 = y2 - arrowSize * Math.sin(angle + Math.PI / 6);
    arrow.setAttribute('points', `${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}`);
    arrow.setAttribute('fill', color);
    arrow.setAttribute('transform', transform);
    this.svgLayer.appendChild(arrow);
  }

  private findNodeAtPosition(x: number, y: number): string | null {
    for (const [id, node] of this.nodes) {
      if (
        x >= node.x &&
        x <= node.x + NODE_WIDTH &&
        y >= node.y &&
        y <= node.y + NODE_HEADER_HEIGHT + 40
      ) {
        return id;
      }
    }
    return null;
  }

  private selectNode(nodeId: string): void {
    this.selectedNodeId = nodeId;
    this.selectedConnectionId = null;
    this.updateSelection();
  }

  private selectConnection(connId: string): void {
    this.selectedConnectionId = connId;
    this.selectedNodeId = null;
    this.updateSelection();
  }

  private updateSelection(): void {
    // Update node selection visuals
    this.nodesLayer?.querySelectorAll('[data-node-id]').forEach((el) => {
      const nodeId = (el as HTMLElement).dataset.nodeId;
      const isSelected = nodeId === this.selectedNodeId;
      (el as HTMLElement).style.borderColor = isSelected ? THEME.accent : THEME.nodeBorder;
      (el as HTMLElement).style.boxShadow = isSelected ? `0 0 0 2px ${THEME.accent}40` : 'none';
    });

    // Update connection visuals
    this.svgLayer?.querySelectorAll('path').forEach((path) => {
      const connId = path.dataset.connId;
      const isSelected = connId === this.selectedConnectionId;
      path.setAttribute('stroke', isSelected ? THEME.accent : THEME.connectionDefault);
      path.setAttribute('stroke-width', isSelected ? '3' : '2');
    });
  }

  private deleteSelected(): void {
    if (this.selectedNodeId) {
      this.deleteNode(this.selectedNodeId);
    } else if (this.selectedConnectionId) {
      this.deleteConnection(this.selectedConnectionId);
    }
    this.hideContextMenu();
  }

  private deleteNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    this.nodesLayer?.querySelector(`[data-node-id="${nodeId}"]`)?.remove();

    // Remove related connections
    const toDelete: string[] = [];
    for (const [id, conn] of this.connections) {
      if (conn.fromNodeId === nodeId || conn.toNodeId === nodeId) {
        toDelete.push(id);
      }
    }
    for (const id of toDelete) {
      this.connections.delete(id);
    }

    this.selectedNodeId = null;
    this.renderConnections();
    this.notifyChange();
  }

  private deleteConnection(connId: string): void {
    this.connections.delete(connId);
    this.selectedConnectionId = null;
    this.renderConnections();
    this.notifyChange();
  }

  private showContextMenu(x: number, y: number): void {
    if (!this.contextMenu) return;
    this.contextMenu.style.left = `${x}px`;
    this.contextMenu.style.top = `${y}px`;
    this.contextMenu.style.display = 'block';
  }

  private hideContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.style.display = 'none';
    }
  }

  private updateTransform(): void {
    if (this.nodesLayer) {
      this.nodesLayer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    }
    this.renderConnections();
  }

  private addInitialNodes(): void {
    // Add start node
    const startNode: CanvasNode = {
      id: 'start',
      type: 'start',
      name: '🚀 开始',
      x: 50,
      y: 200,
      properties: {},
      inputs: [],
      outputs: ['next'],
    };
    this.nodes.set(startNode.id, startNode);
    this.renderNode(startNode);

    // Add end node
    const endNode: CanvasNode = {
      id: 'end',
      type: 'end',
      name: '🏁 结束',
      x: 500,
      y: 200,
      properties: {},
      inputs: ['done'],
      outputs: [],
    };
    this.nodes.set(endNode.id, endNode);
    this.renderNode(endNode);

    this.renderConnections();
  }

  private loadFromDefinition(definition: WorkflowDefinition): void {
    // Clear existing
    this.nodes.clear();
    this.connections.clear();
    this.nodesLayer?.querySelectorAll('[data-node-id]').forEach((el) => el.remove());

    if (!this.svgLayer) return;
    while (this.svgLayer.firstChild) {
      this.svgLayer.removeChild(this.svgLayer.firstChild);
    }

    // Layout nodes based on sequence
    const stepNodes: CanvasNode[] = [];
    let x = 250;
    const y = 200;

    for (const step of definition.sequence) {
      const node: CanvasNode = {
        id: step.id,
        type: step.type as CanvasNode['type'],
        name: step.name,
        x,
        y,
        properties: { ...step.properties },
        inputs: ['input'],
        outputs: ['output'],
      };
      this.nodes.set(node.id, node);
      stepNodes.push(node);
      this.renderNode(node);
      x += 250;
    }

    // Create connections between sequential nodes
    for (let i = 0; i < stepNodes.length - 1; i++) {
      const conn: CanvasConnection = {
        id: `conn-${i}`,
        fromNodeId: stepNodes[i].id,
        fromPort: 'output',
        toNodeId: stepNodes[i + 1].id,
        toPort: 'input',
      };
      this.connections.set(conn.id, conn);
    }

    // Add start and end if there are steps
    if (stepNodes.length > 0) {
      const startNode: CanvasNode = {
        id: 'start',
        type: 'start',
        name: '🚀 开始',
        x: 50,
        y,
        properties: {},
        inputs: [],
        outputs: ['next'],
      };
      this.nodes.set(startNode.id, startNode);
      this.renderNode(startNode);

      const endConn: CanvasConnection = {
        id: `conn-end`,
        fromNodeId: stepNodes[stepNodes.length - 1].id,
        fromPort: 'output',
        toNodeId: 'end',
        toPort: 'done',
      };
      this.connections.set(endConn.id, endConn);

      const endNode: CanvasNode = {
        id: 'end',
        type: 'end',
        name: '🏁 结束',
        x: x + 50,
        y,
        properties: {},
        inputs: ['done'],
        outputs: [],
      };
      this.nodes.set(endNode.id, endNode);
      this.renderNode(endNode);

      // Connect start to first
      const startConn: CanvasConnection = {
        id: `conn-start`,
        fromNodeId: 'start',
        fromPort: 'next',
        toNodeId: stepNodes[0].id,
        toPort: 'input',
      };
      this.connections.set(startConn.id, startConn);
    }

    this.renderConnections();
  }

  private notifyChange(): void {
    const definition = this.toDefinition();
    this.config.onChange?.(definition);
  }

  private toDefinition(): WorkflowDefinition {
    const sequence: WorkflowStep[] = [];

    // Find start node and follow connections
    const visited = new Set<string>();
    let currentNodeId = 'start';

    while (currentNodeId && !visited.has(currentNodeId)) {
      visited.add(currentNodeId);
      const node = this.nodes.get(currentNodeId);

      if (!node || node.type === 'start' || node.type === 'end') {
        // Find next connected node
        currentNodeId = this.findNextNode(currentNodeId);
        continue;
      }

      const step: WorkflowStep = {
        id: node.id,
        componentType: node.type === 'condition' ? 'condition' : node.type === 'delay' ? 'delay' : 'task',
        type: node.type as WorkflowStep['type'],
        name: node.name,
        properties: { ...node.properties },
      };

      sequence.push(step);
      currentNodeId = this.findNextNode(currentNodeId);
    }

    return {
      properties: {
        name: '拖拽工作流',
        description: '',
      },
      sequence,
    };
  }

  private findNextNode(fromNodeId: string): string {
    for (const conn of this.connections.values()) {
      if (conn.fromNodeId === fromNodeId) {
        return conn.toNodeId;
      }
    }
    return '';
  }

  getDefinition(): WorkflowDefinition {
    return this.toDefinition();
  }

  async setDefinition(definition: WorkflowDefinition): Promise<void> {
    this.loadFromDefinition(definition);
  }

  destroy(): void {
    this.container?.remove();
    this.container = null;
    this.nodes.clear();
    this.connections.clear();
  }
}
