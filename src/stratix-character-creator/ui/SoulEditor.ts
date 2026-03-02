import Phaser from 'phaser';
import { getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';
import { ContainerComponentBase } from '@/stratix-core/ui/ContainerComponent.base';
import type { StratixSoulConfig } from '@/stratix-core/stratix-protocol';
import { SOUL_TEMPLATES, DEFAULT_SOUL, type SoulTemplate } from '../config/soulTemplates';

export interface SoulEditorConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  initialSoul?: StratixSoulConfig;
  onChange?: (soul: StratixSoulConfig) => void;
}

const THEME = {
  bg: getToken('colors.background.secondary'),
  border: getToken('colors.border.default'),
  accent: getToken('colors.primary'),
  text: getToken('colors.text.primary'),
  textMuted: getToken('colors.text.muted'),
  inputBg: getToken('colors.background.tertiary'),
  success: getToken('colors.semantic.success'),
};

export class SoulEditor {
  private scene: Phaser.Scene;
  private config: SoulEditorConfig;
  private container: Phaser.GameObjects.DOMElement | null = null;
  private soul: StratixSoulConfig;
  private onChange?: (soul: StratixSoulConfig) => void;

  constructor(scene: Phaser.Scene, config: SoulEditorConfig) {
    this.scene = scene;
    this.config = config;
    this.soul = config.initialSoul ? { ...config.initialSoul } : { ...DEFAULT_SOUL };
    this.onChange = config.onChange;
  }

  create(): Phaser.GameObjects.DOMElement {
    const html = this.generateHTML();
    this.container = this.scene.add.dom(this.config.x, this.config.y).createFromHTML(html).setOrigin(0, 0).setDepth(Depth.UI_MODAL_CONTENT);
    this.setupEventListeners();
    return this.container;
  }

  private generateHTML(): string {
    const templateOptions = SOUL_TEMPLATES.map(
      t => `<option value="${t.id}">${t.name} - ${t.description}</option>`
    ).join('');

    const goalsHtml = this.soul.goals
      .map(
        (goal, i) => `
        <div class="goal-item" data-index="${i}" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <span style="flex: 1; color: ${THEME.text}; font-size: 12px;">${this.escapeHtml(goal)}</span>
          <button class="remove-goal-btn" data-index="${i}" style="
            background: #3a2a2a;
            border: none;
            color: #ff6666;
            padding: 2px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
          ">删除</button>
        </div>
      `
      )
      .join('');

    return `
      <div class="soul-editor" style="
        width: ${this.config.width}px;
        height: ${this.config.height}px;
        background: ${THEME.bg};
        border: 1px solid ${THEME.border};
        border-radius: 8px;
        padding: 16px;
        font-family: system-ui, -apple-system, sans-serif;
        color: ${THEME.text};
        overflow-y: auto;
        box-sizing: border-box;
      ">
        <div class="section" style="margin-bottom: 16px;">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 8px;">
            快速选择模板
          </label>
          <select id="soul-template-select" style="
            width: 100%;
            padding: 8px 12px;
            background: ${THEME.inputBg};
            border: 1px solid ${THEME.border};
            border-radius: 6px;
            color: ${THEME.text};
            font-size: 12px;
          ">
            <option value="">-- 选择模板 --</option>
            ${templateOptions}
          </select>
        </div>

        <div class="section" style="margin-bottom: 16px;">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
            身份 IDENTITY
          </label>
          <textarea id="soul-identity" placeholder="描述 Agent 的身份定位..." style="
            width: 100%;
            height: 80px;
            padding: 10px 12px;
            background: ${THEME.inputBg};
            border: 1px solid ${THEME.border};
            border-radius: 6px;
            color: ${THEME.text};
            font-size: 12px;
            resize: vertical;
            box-sizing: border-box;
          ">${this.escapeHtml(this.soul.identity)}</textarea>
        </div>

        <div class="section" style="margin-bottom: 16px;">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
            目标 GOALS
          </label>
          <div id="goals-list" style="margin-bottom: 8px;">
            ${goalsHtml || '<span style="color: ' + THEME.textMuted + '; font-size: 12px;">暂无目标</span>'}
          </div>
          <div style="display: flex; gap: 8px;">
            <input type="text" id="new-goal-input" placeholder="输入新目标..." style="
              flex: 1;
              padding: 8px 12px;
              background: ${THEME.inputBg};
              border: 1px solid ${THEME.border};
              border-radius: 6px;
              color: ${THEME.text};
              font-size: 12px;
            " />
            <button id="add-goal-btn" style="
              padding: 8px 16px;
              background: #1a3a3a;
              border: 1px solid ${THEME.accent};
              border-radius: 6px;
              color: ${THEME.accent};
              font-size: 12px;
              cursor: pointer;
            ">添加</button>
          </div>
        </div>

        <div class="section">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
            性格 PERSONALITY
          </label>
          <input type="text" id="soul-personality" value="${this.escapeHtml(this.soul.personality)}" placeholder="描述 Agent 的性格特点..." style="
            width: 100%;
            padding: 10px 12px;
            background: ${THEME.inputBg};
            border: 1px solid ${THEME.border};
            border-radius: 6px;
            color: ${THEME.text};
            font-size: 12px;
            box-sizing: border-box;
          " />
        </div>
      </div>
    `;
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;

    const templateSelect = node.querySelector('#soul-template-select') as HTMLSelectElement;
    const identityInput = node.querySelector('#soul-identity') as HTMLTextAreaElement;
    const personalityInput = node.querySelector('#soul-personality') as HTMLInputElement;
    const goalsList = node.querySelector('#goals-list') as HTMLElement;
    const newGoalInput = node.querySelector('#new-goal-input') as HTMLInputElement;
    const addGoalBtn = node.querySelector('#add-goal-btn') as HTMLButtonElement;

    templateSelect?.addEventListener('change', (e) => {
      const templateId = (e.target as HTMLSelectElement).value;
      if (templateId) {
        const template = SOUL_TEMPLATES.find((t) => t.id === templateId);
        if (template) {
          this.applyTemplate(template);
        }
      }
    });

    identityInput?.addEventListener('input', (e) => {
      this.soul.identity = (e.target as HTMLTextAreaElement).value;
      this.notifyChange();
    });

    personalityInput?.addEventListener('input', (e) => {
      this.soul.personality = (e.target as HTMLInputElement).value;
      this.notifyChange();
    });

    addGoalBtn?.addEventListener('click', () => {
      const goal = newGoalInput?.value.trim();
      if (goal) {
        this.soul.goals.push(goal);
        newGoalInput.value = '';
        this.refreshGoalsList();
        this.notifyChange();
      }
    });

    newGoalInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        addGoalBtn?.click();
      }
    });

    goalsList?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('remove-goal-btn')) {
        const index = parseInt(target.dataset.index || '0', 10);
        this.soul.goals.splice(index, 1);
        this.refreshGoalsList();
        this.notifyChange();
      }
    });
  }

  private applyTemplate(template: SoulTemplate): void {
    this.soul = {
      identity: template.soul.identity,
      goals: [...template.soul.goals],
      personality: template.soul.personality,
    };

    const node = this.container?.node as HTMLElement;
    if (!node) return;

    const identityInput = node.querySelector('#soul-identity') as HTMLTextAreaElement;
    const personalityInput = node.querySelector('#soul-personality') as HTMLInputElement;

    if (identityInput) identityInput.value = this.soul.identity;
    if (personalityInput) personalityInput.value = this.soul.personality;

    this.refreshGoalsList();
    this.notifyChange();
  }

  private refreshGoalsList(): void {
    const node = this.container?.node as HTMLElement;
    const goalsList = node?.querySelector('#goals-list') as HTMLElement;
    if (!goalsList) return;

    if (this.soul.goals.length === 0) {
      goalsList.innerHTML = `<span style="color: ${THEME.textMuted}; font-size: 12px;">暂无目标</span>`;
      return;
    }

    goalsList.innerHTML = this.soul.goals
      .map(
        (goal, i) => `
        <div class="goal-item" data-index="${i}" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <span style="flex: 1; color: ${THEME.text}; font-size: 12px;">${this.escapeHtml(goal)}</span>
          <button class="remove-goal-btn" data-index="${i}" style="
            background: #3a2a2a;
            border: none;
            color: #ff6666;
            padding: 2px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
          ">删除</button>
        </div>
      `
      )
      .join('');
  }

  private escapeHtml(text: string): string {
    const div = { innerHTML: '' } as HTMLElement;
    div.textContent = text;
    return div.innerHTML;
  }

  private notifyChange(): void {
    this.onChange?.(this.getSoul());
  }

  getSoul(): StratixSoulConfig {
    return {
      identity: this.soul.identity,
      goals: [...this.soul.goals],
      personality: this.soul.personality,
    };
  }

  setSoul(soul: StratixSoulConfig): void {
    this.soul = {
      identity: soul.identity,
      goals: [...soul.goals],
      personality: soul.personality,
    };

    const node = this.container?.node as HTMLElement;
    if (!node) return;

    const identityInput = node.querySelector('#soul-identity') as HTMLTextAreaElement;
    const personalityInput = node.querySelector('#soul-personality') as HTMLInputElement;

    if (identityInput) identityInput.value = this.soul.identity;
    if (personalityInput) personalityInput.value = this.soul.personality;

    this.refreshGoalsList();
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.soul.identity.trim()) {
      errors.push('身份描述不能为空');
    }

    if (this.soul.goals.length === 0) {
      errors.push('至少需要添加一个目标');
    }

    if (!this.soul.personality.trim()) {
      errors.push('性格描述不能为空');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  destroy(): void {
    this.container?.destroy();
  }
}

export default SoulEditor;
