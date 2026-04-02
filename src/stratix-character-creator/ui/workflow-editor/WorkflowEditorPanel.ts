import {
  Designer,
  Definition,
  Step,
  DesignerConfiguration,
  DefinitionChangeType,
  BranchedStep,
} from 'sequential-workflow-designer';

import 'sequential-workflow-designer/css/designer.css';
import 'sequential-workflow-designer/css/designer-dark.css';
import { providerRegistry } from '@/agent-platform/providers/registry';
import { allPresets } from '@/agent-platform/workflow/presets';
import type { WorkflowDefinition, WorkflowStep, WorkflowStatus } from '@/agent-platform/workflow/types';

export type WorkflowExecutionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error' | 'stopped';

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
};

export interface WorkflowEditorConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  initialDefinition?: WorkflowDefinition;
  onChange?: (definition: WorkflowDefinition) => void;
  onExecute?: (status: WorkflowExecutionStatus, definition?: WorkflowDefinition) => void;
}

interface AgentStep extends Step {
  sequences?: Step[][];
}

export class WorkflowEditorPanel {
  private container: HTMLDivElement | null = null;
  private designer: Designer | null = null;
  private config: WorkflowEditorConfig;
  private currentDefinition: WorkflowDefinition;
  private executionStatus: WorkflowExecutionStatus = 'idle';
  private statusDisplay: HTMLSpanElement | null = null;
  private runBtn: HTMLButtonElement | null = null;
  private pauseBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;

  constructor(config: WorkflowEditorConfig) {
    this.config = config;
    this.currentDefinition = config.initialDefinition || this.createDefaultDefinition();
  }

  create(parent: HTMLElement): HTMLDivElement {
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position: absolute;
      left: ${this.config.x}px;
      top: ${this.config.y}px;
      width: ${this.config.width}px;
      height: ${this.config.height}px;
      background: ${THEME.bg};
      border: 1px solid ${THEME.border};
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    `;

    const header = this.createHeader();
    this.container.appendChild(header);

    const canvasContainer = document.createElement('div');
    canvasContainer.id = 'workflow-canvas';
    canvasContainer.style.cssText = `
      flex: 1;
      position: relative;
    `;
    this.container.appendChild(canvasContainer);

    parent.appendChild(this.container);

    setTimeout(() => {
      this.initDesigner(canvasContainer);
    }, 0);

    return this.container;
  }

  private createHeader(): HTMLElement {
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 12px 16px;
      background: ${THEME.bgSecondary};
      border-bottom: 1px solid ${THEME.border};
      display: flex;
      align-items: center;
      gap: 12px;
    `;

    const title = document.createElement('span');
    title.textContent = '工作流配置';
    title.style.cssText = `
      color: ${THEME.text};
      font-size: 14px;
      font-weight: 500;
    `;
    header.appendChild(title);

    // Execution controls section
    const execControls = document.createElement('div');
    execControls.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: 12px;
      padding-left: 12px;
      border-left: 1px solid ${THEME.border};
    `;

    this.runBtn = document.createElement('button');
    this.runBtn.textContent = '▶ 运行';
    this.runBtn.style.cssText = `
      padding: 6px 12px;
      background: ${THEME.success};
      border: none;
      border-radius: 4px;
      color: white;
      font-size: 12px;
      cursor: pointer;
    `;
    this.runBtn.addEventListener('click', () => this.handleRun());

    this.pauseBtn = document.createElement('button');
    this.pauseBtn.textContent = '⏸ 暂停';
    this.pauseBtn.disabled = true;
    this.pauseBtn.style.cssText = `
      padding: 6px 12px;
      background: ${THEME.warning};
      border: none;
      border-radius: 4px;
      color: white;
      font-size: 12px;
      cursor: pointer;
      opacity: 0.5;
    `;
    this.pauseBtn.addEventListener('click', () => this.handlePause());

    this.stopBtn = document.createElement('button');
    this.stopBtn.textContent = '⏹ 停止';
    this.stopBtn.disabled = true;
    this.stopBtn.style.cssText = `
      padding: 6px 12px;
      background: ${THEME.error};
      border: none;
      border-radius: 4px;
      color: white;
      font-size: 12px;
      cursor: pointer;
      opacity: 0.5;
    `;
    this.stopBtn.addEventListener('click', () => this.handleStop());

    execControls.appendChild(this.runBtn);
    execControls.appendChild(this.pauseBtn);
    execControls.appendChild(this.stopBtn);

    this.statusDisplay = document.createElement('span');
    this.statusDisplay.textContent = '就绪';
    this.statusDisplay.style.cssText = `
      color: ${THEME.textMuted};
      font-size: 11px;
      min-width: 60px;
    `;
    execControls.appendChild(this.statusDisplay);

    header.appendChild(execControls);

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    header.appendChild(spacer);

    const presetSelect = document.createElement('select');
    presetSelect.style.cssText = `
      padding: 6px 12px;
      background: ${THEME.inputBg};
      border: 1px solid ${THEME.border};
      border-radius: 4px;
      color: ${THEME.text};
      font-size: 12px;
    `;

    presetSelect.innerHTML = `
      <option value="">选择模板...</option>
      ${allPresets.map((p) => `<option value="${p.id}">${p.icon || '📋'} ${p.name}</option>`).join('')}
    `;

    presetSelect.addEventListener('change', (e) => {
      const presetId = (e.target as HTMLSelectElement).value;
      if (presetId) {
        this.loadPreset(presetId);
      }
    });

    header.appendChild(presetSelect);

    return header;
  }

  private handleRun(): void {
    if (this.executionStatus === 'idle' || this.executionStatus === 'stopped' || this.executionStatus === 'completed' || this.executionStatus === 'error') {
      this.executionStatus = 'running';
      this.updateExecutionUI();
      this.config.onExecute?.('running', this.currentDefinition);
    }
  }

  private handlePause(): void {
    if (this.executionStatus === 'running') {
      this.executionStatus = 'paused';
      this.updateExecutionUI();
      this.config.onExecute?.('paused');
    }
  }

  private handleStop(): void {
    if (this.executionStatus === 'running' || this.executionStatus === 'paused') {
      this.executionStatus = 'stopped';
      this.updateExecutionUI();
      this.config.onExecute?.('stopped');
    }
  }

  private updateExecutionUI(): void {
    if (!this.runBtn || !this.pauseBtn || !this.stopBtn || !this.statusDisplay) return;

    switch (this.executionStatus) {
      case 'idle':
        this.runBtn.disabled = false;
        this.pauseBtn.disabled = true;
        this.stopBtn.disabled = true;
        this.statusDisplay.textContent = '就绪';
        this.statusDisplay.style.color = THEME.textMuted;
        break;
      case 'running':
        this.runBtn.disabled = true;
        this.pauseBtn.disabled = false;
        this.stopBtn.disabled = false;
        this.statusDisplay.textContent = '运行中';
        this.statusDisplay.style.color = THEME.success;
        break;
      case 'paused':
        this.runBtn.disabled = false;
        this.pauseBtn.disabled = true;
        this.stopBtn.disabled = false;
        this.statusDisplay.textContent = '已暂停';
        this.statusDisplay.style.color = THEME.warning;
        break;
      case 'completed':
        this.runBtn.disabled = false;
        this.pauseBtn.disabled = true;
        this.stopBtn.disabled = true;
        this.statusDisplay.textContent = '已完成';
        this.statusDisplay.style.color = THEME.success;
        break;
      case 'error':
        this.runBtn.disabled = false;
        this.pauseBtn.disabled = true;
        this.stopBtn.disabled = true;
        this.statusDisplay.textContent = '出错';
        this.statusDisplay.style.color = THEME.error;
        break;
      case 'stopped':
        this.runBtn.disabled = false;
        this.pauseBtn.disabled = true;
        this.stopBtn.disabled = true;
        this.statusDisplay.textContent = '已停止';
        this.statusDisplay.style.color = THEME.textMuted;
        break;
    }
  }

  private initDesigner(container: HTMLElement): void {
    const definition = this.convertToSWDDefinition(this.currentDefinition);
    const configuration = this.createConfiguration();

    this.designer = Designer.create(container, definition, configuration);
    this.designer.onDefinitionChanged.subscribe((event) => {
      if (event.changeType !== DefinitionChangeType.rootReplaced) {
        this.currentDefinition = this.convertFromSWDDefinition(event.definition);
        this.config.onChange?.(this.currentDefinition);
      }
    });
  }

  private createConfiguration(): DesignerConfiguration {
    return {
      theme: 'dark',
      undoStackSize: 20,
      steps: {},
      toolbox: {
        isCollapsed: false,
        groups: [
          {
            name: 'LLM 节点',
            steps: this.getLLMNodeTemplates(),
          },
          {
            name: '控制流',
            steps: this.getControlFlowTemplates(),
          },
        ],
      },
      editors: {
        isCollapsed: false,
        stepEditorProvider: (step, context) => this.createStepEditor(step, context),
        rootEditorProvider: () => {
          const el = document.createElement('div');
          el.innerHTML = '<div style="padding:12px;color:#8b8b8b;">工作流根节点</div>';
          return el;
        },
      },
      controlBar: true,
    };
  }

  private getLLMNodeTemplates(): Step[] {
    const providers = providerRegistry.getAllConfigs();
    return providers.slice(0, 4).map((provider) => ({
      id: `llm-${provider.id}`,
      componentType: 'task',
      type: 'llm',
      name: provider.name,
      properties: {
        providerId: provider.id,
        model: provider.models[0] || '',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 4096,
      },
    }));
  }

  private getControlFlowTemplates(): Step[] {
    return [
      {
        id: 'agent',
        componentType: 'task',
        type: 'agent',
        name: 'Agent 节点',
        properties: {
          agentType: 'assistant',
          systemPrompt: '你是一个智能助手。',
        },
      },
      {
        id: 'condition',
        componentType: 'condition',
        type: 'condition',
        name: '条件判断',
        properties: {
          expression: '',
        },
        branches: {
          true: [],
          false: [],
        },
      } as BranchedStep,
      {
        id: 'parallel',
        componentType: 'parallel',
        type: 'parallel',
        name: '并行执行',
        properties: {},
        branches: {
          branch1: [],
          branch2: [],
        },
      } as BranchedStep,
      {
        id: 'delay',
        componentType: 'delay',
        type: 'delay',
        name: '延迟节点',
        properties: {
          delayDuration: 1000,
          delayUnit: 'ms',
        },
      },
      {
        id: 'router',
        componentType: 'switch',
        type: 'router',
        name: '条件路由',
        properties: {
          condition: '',
        },
        branches: {
          default: [],
        },
      } as BranchedStep,
      {
        id: 'human',
        componentType: 'task',
        type: 'human',
        name: '人工审核',
        properties: {},
      },
    ];
  }

  private createStepEditor(
    step: Step,
    context: { notifyNameChanged: () => void; notifyPropertiesChanged: () => void; notifyChildrenChanged: () => void }
  ): HTMLElement {
    const editor = document.createElement('div');
    editor.style.cssText = `
      padding: 12px;
      background: ${THEME.bgSecondary};
      color: ${THEME.text};
      font-size: 12px;
    `;

    if (step.type === 'llm') {
      editor.innerHTML = this.createLLMEditorHTML(step);
      this.setupLLMEditorEvents(editor, step, context);
    } else if (step.type === 'agent') {
      editor.innerHTML = this.createAgentEditorHTML(step);
      this.setupAgentEditorEvents(editor, step, context);
    } else if (step.type === 'condition') {
      editor.innerHTML = this.createConditionEditorHTML(step);
      this.setupConditionEditorEvents(editor, step, context);
    } else if (step.type === 'delay') {
      editor.innerHTML = this.createDelayEditorHTML(step);
      this.setupDelayEditorEvents(editor, step, context);
    } else {
      editor.innerHTML = `
        <div style="margin-bottom: 12px;">
          <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">节点名称</label>
          <input type="text" value="${step.name}" id="editor-name" style="
            width: 100%;
            padding: 8px;
            background: ${THEME.inputBg};
            border: 1px solid ${THEME.border};
            border-radius: 4px;
            color: ${THEME.text};
          " />
        </div>
        <div style="color: ${THEME.textMuted};">类型: ${step.type}</div>
      `;

      const nameInput = editor.querySelector('#editor-name') as HTMLInputElement;
      nameInput?.addEventListener('input', (e) => {
        step.name = (e.target as HTMLInputElement).value;
        context.notifyNameChanged();
      });
    }

    return editor;
  }

  private createLLMEditorHTML(step: Step): string {
    const providers = providerRegistry.getAllConfigs();
    const currentProvider = (step.properties.providerId as string) || 'openai';
    const models = providerRegistry.getModels(currentProvider);

    return `
      <div style="margin-bottom: 12px;">
        <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">Provider</label>
        <select id="editor-provider" style="
          width: 100%;
          padding: 8px;
          background: ${THEME.inputBg};
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          color: ${THEME.text};
        ">
          ${providers
            .map(
              (p) =>
                `<option value="${p.id}" ${p.id === currentProvider ? 'selected' : ''}>${p.icon} ${p.name}</option>`
            )
            .join('')}
        </select>
      </div>
      <div style="margin-bottom: 12px;">
        <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">Model</label>
        <select id="editor-model" style="
          width: 100%;
          padding: 8px;
          background: ${THEME.inputBg};
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          color: ${THEME.text};
        ">
          ${models
            .map((m) => `<option value="${m}" ${m === step.properties.model ? 'selected' : ''}>${m}</option>`)
            .join('')}
        </select>
      </div>
      <div style="margin-bottom: 12px;">
        <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">System Prompt</label>
        <textarea id="editor-prompt" style="
          width: 100%;
          height: 80px;
          padding: 8px;
          background: ${THEME.inputBg};
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          color: ${THEME.text};
          resize: vertical;
        ">${(step.properties.systemPrompt as string) || ''}</textarea>
      </div>
      <div style="display: flex; gap: 12px;">
        <div style="flex: 1;">
          <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">Temperature</label>
          <input type="number" id="editor-temp" value="${step.properties.temperature ?? 0.7}" min="0" max="2" step="0.1" style="
            width: 100%;
            padding: 8px;
            background: ${THEME.inputBg};
            border: 1px solid ${THEME.border};
            border-radius: 4px;
            color: ${THEME.text};
          " />
        </div>
        <div style="flex: 1;">
          <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">Max Tokens</label>
          <input type="number" id="editor-tokens" value="${step.properties.maxTokens ?? 4096}" min="1" max="128000" style="
            width: 100%;
            padding: 8px;
            background: ${THEME.inputBg};
            border: 1px solid ${THEME.border};
            border-radius: 4px;
            color: ${THEME.text};
          " />
        </div>
      </div>
    `;
  }

  private setupLLMEditorEvents(
    editor: HTMLElement,
    step: Step,
    context: { notifyPropertiesChanged: () => void }
  ): void {
    const providerSelect = editor.querySelector('#editor-provider') as HTMLSelectElement;
    const modelSelect = editor.querySelector('#editor-model') as HTMLSelectElement;
    const promptInput = editor.querySelector('#editor-prompt') as HTMLTextAreaElement;
    const tempInput = editor.querySelector('#editor-temp') as HTMLInputElement;
    const tokensInput = editor.querySelector('#editor-tokens') as HTMLInputElement;

    providerSelect?.addEventListener('change', (e) => {
      const providerId = (e.target as HTMLSelectElement).value;
      step.properties.providerId = providerId;
      step.properties.model = providerRegistry.getModels(providerId)[0] || '';

      const models = providerRegistry.getModels(providerId);
      modelSelect.innerHTML = models.map((m) => `<option value="${m}">${m}</option>`).join('');

      context.notifyPropertiesChanged();
    });

    modelSelect?.addEventListener('change', (e) => {
      step.properties.model = (e.target as HTMLSelectElement).value;
      context.notifyPropertiesChanged();
    });

    promptInput?.addEventListener('input', (e) => {
      step.properties.systemPrompt = (e.target as HTMLTextAreaElement).value;
      context.notifyPropertiesChanged();
    });

    tempInput?.addEventListener('input', (e) => {
      step.properties.temperature = parseFloat((e.target as HTMLInputElement).value);
      context.notifyPropertiesChanged();
    });

    tokensInput?.addEventListener('input', (e) => {
      step.properties.maxTokens = parseInt((e.target as HTMLInputElement).value);
      context.notifyPropertiesChanged();
    });
  }

  private createAgentEditorHTML(step: Step): string {
    return `
      <div style="margin-bottom: 12px;">
        <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">节点名称</label>
        <input type="text" value="${step.name}" id="editor-name" style="
          width: 100%;
          padding: 8px;
          background: ${THEME.inputBg};
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          color: ${THEME.text};
        " />
      </div>
      <div style="margin-bottom: 12px;">
        <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">Agent 类型</label>
        <select id="editor-agent-type" style="
          width: 100%;
          padding: 8px;
          background: ${THEME.inputBg};
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          color: ${THEME.text};
        ">
          <option value="assistant" ${step.properties.agentType === 'assistant' ? 'selected' : ''}>助手</option>
          <option value="coder" ${step.properties.agentType === 'coder' ? 'selected' : ''}>编码助手</option>
          <option value="analyst" ${step.properties.agentType === 'analyst' ? 'selected' : ''}>分析师</option>
          <option value="reviewer" ${step.properties.agentType === 'reviewer' ? 'selected' : ''}>审查员</option>
        </select>
      </div>
      <div style="margin-bottom: 12px;">
        <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">System Prompt</label>
        <textarea id="editor-prompt" style="
          width: 100%;
          height: 80px;
          padding: 8px;
          background: ${THEME.inputBg};
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          color: ${THEME.text};
          resize: vertical;
        ">${(step.properties.systemPrompt as string) || ''}</textarea>
      </div>
    `;
  }

  private setupAgentEditorEvents(
    editor: HTMLElement,
    step: Step,
    context: { notifyNameChanged: () => void; notifyPropertiesChanged: () => void }
  ): void {
    const nameInput = editor.querySelector('#editor-name') as HTMLInputElement;
    const agentTypeSelect = editor.querySelector('#editor-agent-type') as HTMLSelectElement;
    const promptInput = editor.querySelector('#editor-prompt') as HTMLTextAreaElement;

    nameInput?.addEventListener('input', (e) => {
      step.name = (e.target as HTMLInputElement).value;
      context.notifyNameChanged();
    });

    agentTypeSelect?.addEventListener('change', (e) => {
      step.properties.agentType = (e.target as HTMLSelectElement).value;
      context.notifyPropertiesChanged();
    });

    promptInput?.addEventListener('input', (e) => {
      step.properties.systemPrompt = (e.target as HTMLTextAreaElement).value;
      context.notifyPropertiesChanged();
    });
  }

  private createConditionEditorHTML(step: Step): string {
    return `
      <div style="margin-bottom: 12px;">
        <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">节点名称</label>
        <input type="text" value="${step.name}" id="editor-name" style="
          width: 100%;
          padding: 8px;
          background: ${THEME.inputBg};
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          color: ${THEME.text};
        " />
      </div>
      <div style="margin-bottom: 12px;">
        <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">条件表达式</label>
        <input type="text" value="${step.properties.expression || ''}" id="editor-expression" placeholder="例如: result > 0" style="
          width: 100%;
          padding: 8px;
          background: ${THEME.inputBg};
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          color: ${THEME.text};
        " />
      </div>
      <div style="margin-bottom: 8px;">
        <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">说明</label>
        <div style="color: ${THEME.textMuted}; font-size: 11px;">
          根据条件表达式的结果（true/false）决定执行哪个分支
        </div>
      </div>
    `;
  }

  private setupConditionEditorEvents(
    editor: HTMLElement,
    step: Step,
    context: { notifyNameChanged: () => void; notifyPropertiesChanged: () => void }
  ): void {
    const nameInput = editor.querySelector('#editor-name') as HTMLInputElement;
    const expressionInput = editor.querySelector('#editor-expression') as HTMLInputElement;

    nameInput?.addEventListener('input', (e) => {
      step.name = (e.target as HTMLInputElement).value;
      context.notifyNameChanged();
    });

    expressionInput?.addEventListener('input', (e) => {
      step.properties.expression = (e.target as HTMLInputElement).value;
      context.notifyPropertiesChanged();
    });
  }

  private createDelayEditorHTML(step: Step): string {
    const duration = step.properties.delayDuration ?? 1000;
    const unit = step.properties.delayUnit || 'ms';
    return `
      <div style="margin-bottom: 12px;">
        <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">节点名称</label>
        <input type="text" value="${step.name}" id="editor-name" style="
          width: 100%;
          padding: 8px;
          background: ${THEME.inputBg};
          border: 1px solid ${THEME.border};
          border-radius: 4px;
          color: ${THEME.text};
        " />
      </div>
      <div style="display: flex; gap: 12px; margin-bottom: 12px;">
        <div style="flex: 2;">
          <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">延迟时长</label>
          <input type="number" id="editor-duration" value="${duration}" min="1" style="
            width: 100%;
            padding: 8px;
            background: ${THEME.inputBg};
            border: 1px solid ${THEME.border};
            border-radius: 4px;
            color: ${THEME.text};
          " />
        </div>
        <div style="flex: 1;">
          <label style="display: block; color: ${THEME.textMuted}; margin-bottom: 4px;">单位</label>
          <select id="editor-unit" style="
            width: 100%;
            padding: 8px;
            background: ${THEME.inputBg};
            border: 1px solid ${THEME.border};
            border-radius: 4px;
            color: ${THEME.text};
          ">
            <option value="ms" ${unit === 'ms' ? 'selected' : ''}>毫秒 (ms)</option>
            <option value="s" ${unit === 's' ? 'selected' : ''}>秒 (s)</option>
            <option value="m" ${unit === 'm' ? 'selected' : ''}>分钟 (m)</option>
            <option value="h" ${unit === 'h' ? 'selected' : ''}>小时 (h)</option>
          </select>
        </div>
      </div>
    `;
  }

  private setupDelayEditorEvents(
    editor: HTMLElement,
    step: Step,
    context: { notifyNameChanged: () => void; notifyPropertiesChanged: () => void }
  ): void {
    const nameInput = editor.querySelector('#editor-name') as HTMLInputElement;
    const durationInput = editor.querySelector('#editor-duration') as HTMLInputElement;
    const unitSelect = editor.querySelector('#editor-unit') as HTMLSelectElement;

    nameInput?.addEventListener('input', (e) => {
      step.name = (e.target as HTMLInputElement).value;
      context.notifyNameChanged();
    });

    durationInput?.addEventListener('input', (e) => {
      step.properties.delayDuration = parseInt((e.target as HTMLInputElement).value);
      context.notifyPropertiesChanged();
    });

    unitSelect?.addEventListener('change', (e) => {
      step.properties.delayUnit = (e.target as HTMLSelectElement).value as 'ms' | 's' | 'm' | 'h';
      context.notifyPropertiesChanged();
    });
  }

  private convertToSWDDefinition(definition: WorkflowDefinition): Definition {
    return {
      properties: {
        name: definition.properties.name,
        description: definition.properties.description || '',
      },
      sequence: definition.sequence.map((step) => this.convertStepToSWD(step)),
    };
  }

  private convertStepToSWD(step: WorkflowStep): Step {
    const swdStep: AgentStep = {
      id: step.id,
      componentType: step.componentType,
      type: step.type,
      name: step.name,
      properties: { ...step.properties },
    };

    if (step.sequences && step.sequences.length > 0) {
      if (step.componentType === 'parallel') {
        const branches: Record<string, Step[]> = {};
        step.sequences.forEach((seq, idx) => {
          branches[`branch${idx + 1}`] = seq.map((s) => this.convertStepToSWD(s));
        });
        (swdStep as BranchedStep).branches = branches;
      } else {
        swdStep.sequences = step.sequences.map((seq) => seq.map((s) => this.convertStepToSWD(s)));
      }
    }

    return swdStep as Step;
  }

  private convertFromSWDDefinition(definition: Definition): WorkflowDefinition {
    return {
      properties: {
        name: (definition.properties.name as string) || 'Untitled',
        description: definition.properties.description as string | undefined,
      },
      sequence: definition.sequence.map((step) => this.convertStepFromSWD(step)),
    };
  }

  private convertStepFromSWD(step: Step): WorkflowStep {
    const workflowStep: WorkflowStep = {
      id: step.id,
      componentType: step.componentType as WorkflowStep['componentType'],
      type: step.type as WorkflowStep['type'],
      name: step.name,
      properties: { ...step.properties } as WorkflowStep['properties'],
    };

    const branchedStep = step as BranchedStep;
    if (branchedStep.branches) {
      workflowStep.sequences = Object.values(branchedStep.branches).map((seq) =>
        seq.map((s) => this.convertStepFromSWD(s))
      );
    }

    return workflowStep;
  }

  private createDefaultDefinition(): WorkflowDefinition {
    return {
      properties: {
        name: '新工作流',
        description: '',
      },
      sequence: [],
    };
  }

  async loadPreset(presetId: string): Promise<void> {
    const preset = allPresets.find((p) => p.id === presetId);
    if (preset && this.designer) {
      this.currentDefinition = JSON.parse(JSON.stringify(preset.definition));
      const swdDef = this.convertToSWDDefinition(this.currentDefinition);
      await this.designer.replaceDefinition(swdDef);
      this.config.onChange?.(this.currentDefinition);
    }
  }

  getDefinition(): WorkflowDefinition {
    return this.currentDefinition;
  }

  async setDefinition(definition: WorkflowDefinition): Promise<void> {
    this.currentDefinition = definition;
    if (this.designer) {
      const swdDef = this.convertToSWDDefinition(definition);
      await this.designer.replaceDefinition(swdDef);
    }
  }

  getExecutionStatus(): WorkflowExecutionStatus {
    return this.executionStatus;
  }

  setExecutionStatus(status: WorkflowExecutionStatus): void {
    this.executionStatus = status;
    this.updateExecutionUI();
  }

  destroy(): void {
    this.designer?.destroy();
    this.container?.remove();
    this.designer = null;
    this.container = null;
  }
}
