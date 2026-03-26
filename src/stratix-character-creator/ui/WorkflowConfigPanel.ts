import Phaser from 'phaser';
import { Depth } from '@/design-system/tokens/depth';
import type { WorkflowDefinition } from '@/agent-platform/workflow/types';
import { WorkflowEditorPanel } from './workflow-editor/WorkflowEditorPanel';
import { getButtonInlineStyles } from './_buttonStyles';

export interface WorkflowConfigPanelConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  initialWorkflow?: WorkflowDefinition;
  onChange?: (workflow: WorkflowDefinition) => void;
}

const THEME = {
  bg: '#1a1a2e',
  bgSecondary: '#16213e',
  border: '#0f3460',
  accent: '#e94560',
  text: '#eaeaea',
  textMuted: '#8b8b8b',
  inputBg: '#0f3460',
  success: '#22c55e',
  error: '#ef4444',
};

export class WorkflowConfigPanel {
  private scene: Phaser.Scene;
  private config: WorkflowConfigPanelConfig;
  private container: Phaser.GameObjects.DOMElement | null = null;
  private editorPanel: WorkflowEditorPanel | null = null;
  private currentWorkflow: WorkflowDefinition;
  private onChange?: (workflow: WorkflowDefinition) => void;

  constructor(scene: Phaser.Scene, config: WorkflowConfigPanelConfig) {
    this.scene = scene;
    this.config = config;
    this.currentWorkflow = config.initialWorkflow || this.createDefaultWorkflow();
    this.onChange = config.onChange;
  }

  async create(): Promise<Phaser.GameObjects.DOMElement> {
    const html = this.generateHTML();
    this.container = this.scene.add
      .dom(this.config.x, this.config.y)
      .createFromHTML(html)
      .setOrigin(0, 0)
      .setDepth(Depth.UI_MODAL_CONTENT);

    this.setupEventListeners();
    this.initEditor();

    return this.container;
  }

  private generateHTML(): string {
    return `
      <div class="workflow-config-panel" style="
        width: ${this.config.width}px;
        height: ${this.config.height}px;
        background: ${THEME.bg};
        border: 1px solid ${THEME.border};
        border-radius: 8px;
        font-family: system-ui, -apple-system, sans-serif;
        color: ${THEME.text};
        overflow: hidden;
        display: flex;
        flex-direction: column;
      ">
        <div class="header" style="
          padding: 12px 16px;
          background: ${THEME.bgSecondary};
          border-bottom: 1px solid ${THEME.border};
          display: flex;
          align-items: center;
          gap: 12px;
        ">
          <span style="font-size: 14px; font-weight: 500;">工作流配置</span>
          <div style="flex: 1;"></div>
          <button id="wf-save-btn" style="${getButtonInlineStyles('primary')}">保存工作流</button>
          <button id="wf-load-btn" style="${getButtonInlineStyles('secondary')}">加载工作流</button>
          <button id="wf-run-btn" style="${getButtonInlineStyles('success')}">运行</button>
        </div>
        <div id="wf-editor-container" style="
          flex: 1;
          position: relative;
        "></div>
        <div id="wf-status" style="
          padding: 8px 16px;
          background: ${THEME.bgSecondary};
          border-top: 1px solid ${THEME.border};
          font-size: 11px;
          color: ${THEME.textMuted};
        ">就绪</div>
      </div>
    `;
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;
    const saveBtn = node.querySelector('#wf-save-btn') as HTMLButtonElement;
    const loadBtn = node.querySelector('#wf-load-btn') as HTMLButtonElement;
    const runBtn = node.querySelector('#wf-run-btn') as HTMLButtonElement;

    saveBtn?.addEventListener('click', () => this.saveWorkflow());
    loadBtn?.addEventListener('click', () => this.showLoadDialog());
    runBtn?.addEventListener('click', () => this.runWorkflow());
  }

  private initEditor(): void {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;
    const editorContainer = node.querySelector('#wf-editor-container') as HTMLElement;

    if (editorContainer) {
      this.editorPanel = new WorkflowEditorPanel({
        x: 0,
        y: 0,
        width: this.config.width,
        height: this.config.height - 80,
        initialDefinition: this.currentWorkflow,
        onChange: (workflow) => {
          this.currentWorkflow = workflow;
          this.onChange?.(workflow);
        },
      });
      this.editorPanel.create(editorContainer);
    }
  }

  private createDefaultWorkflow(): WorkflowDefinition {
    return {
      properties: {
        name: '新工作流',
        description: '自定义工作流',
      },
      sequence: [],
    };
  }

  getWorkflow(): WorkflowDefinition {
    return this.editorPanel?.getDefinition() || this.currentWorkflow;
  }

  setWorkflow(workflow: WorkflowDefinition): void {
    this.currentWorkflow = workflow;
    this.editorPanel?.setDefinition(workflow);
  }

  private async saveWorkflow(): Promise<void> {
    const workflow = this.getWorkflow();
    const id = `workflow-${Date.now()}`;

    if (typeof window !== 'undefined' && (window as any).electronAPI?.workflow) {
      const result = await (window as any).electronAPI.workflow.save(id, workflow);
      if (result.success) {
        this.showStatus('工作流已保存', 'success');
      } else {
        this.showStatus(`保存失败: ${result.error}`, 'error');
      }
    } else {
      const json = JSON.stringify(workflow, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${workflow.properties.name || 'workflow'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showStatus('工作流已下载', 'success');
    }
  }

  private async showLoadDialog(): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.workflow) {
      this.showSavedWorkflowsDialog();
    } else {
      this.showFileImport();
    }
  }

  private async showSavedWorkflowsDialog(): Promise<void> {
    const result = await (window as any).electronAPI.workflow.list();
    if (!result.success) {
      this.showStatus(`加载失败: ${result.error}`, 'error');
      return;
    }

    const dialog = document.createElement('div');
    dialog.innerHTML = `
      <div style="
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      ">
        <div style="
          background: ${THEME.bg};
          border: 1px solid ${THEME.border};
          border-radius: 12px;
          padding: 24px;
          width: 400px;
          max-height: 80vh;
          overflow-y: auto;
        ">
          <h3 style="margin: 0 0 16px 0; color: ${THEME.text};">加载工作流</h3>
          <div class="workflow-list" style="margin-bottom: 16px;">
            ${result.workflows
              .map(
                (w: any) => `
              <div class="workflow-item" data-id="${w.id}" style="
                padding: 12px;
                background: ${THEME.bgSecondary};
                border: 1px solid ${THEME.border};
                border-radius: 6px;
                margin-bottom: 8px;
                cursor: pointer;
              ">
                <div style="font-size: 13px; color: ${THEME.text};">${w.name}</div>
                <div style="font-size: 11px; color: ${THEME.textMuted}; margin-top: 4px;">
                  ${new Date(w.updatedAt).toLocaleString()}
                </div>
              </div>
            `
              )
              .join('')}
          </div>
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button class="cancel-btn" style="${getButtonInlineStyles('ghost')}">取消</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    dialog.querySelectorAll('.workflow-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const id = (item as HTMLElement).dataset.id;
        const loadResult = await (window as any).electronAPI.workflow.load(id);
        if (loadResult.success && loadResult.workflow) {
          this.setWorkflow(loadResult.workflow);
          this.showStatus('工作流已加载', 'success');
        }
        document.body.removeChild(dialog);
      });
    });

    dialog.querySelector('.cancel-btn')?.addEventListener('click', () => {
      document.body.removeChild(dialog);
    });
  }

  private showFileImport(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const text = await file.text();
          const workflow = JSON.parse(text) as WorkflowDefinition;
          this.setWorkflow(workflow);
          this.showStatus('工作流已导入', 'success');
        } catch {
          this.showStatus('无效的工作流文件', 'error');
        }
      }
    };
    input.click();
  }

  private async runWorkflow(): Promise<void> {
    const workflow = this.getWorkflow();
    this.showStatus('正在运行...', 'info');

    if (typeof window !== 'undefined' && (window as any).electronAPI?.execution) {
      const result = await (window as any).electronAPI.execution.start(
        `run-${Date.now()}`,
        workflow,
        '开始执行工作流'
      );
      if (result.success) {
        this.showStatus(`执行已启动: ${result.executionId}`, 'success');
      } else {
        this.showStatus(`启动失败: ${result.error}`, 'error');
      }
    } else {
      this.showStatus('运行功能需要 Electron 环境', 'error');
    }
  }

  private showStatus(message: string, type: 'success' | 'error' | 'info'): void {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;
    const statusDiv = node.querySelector('#wf-status') as HTMLElement;

    if (statusDiv) {
      statusDiv.textContent = message;
      statusDiv.style.color =
        type === 'success' ? THEME.success : type === 'error' ? THEME.error : THEME.textMuted;
    }
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const workflow = this.getWorkflow();

    if (!workflow.properties.name?.trim()) {
      errors.push('请输入工作流名称');
    }

    if (!workflow.sequence || workflow.sequence.length === 0) {
      errors.push('工作流至少需要一个节点');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  destroy(): void {
    this.editorPanel?.destroy();
    this.container?.destroy();
  }
}

export default WorkflowConfigPanel;
