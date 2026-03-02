import Phaser from 'phaser';
import { getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';
import { ContainerComponentBase } from '@/stratix-core/ui/ContainerComponent.base';
import { RULE_TEMPLATES, DEFAULT_RULES, type RuleTemplate } from '../config/ruleTemplates';

export interface RulesEditorConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  initialRules?: string[];
  onChange?: (rules: string[]) => void;
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

export class RulesEditor {
  private scene: Phaser.Scene;
  private config: RulesEditorConfig;
  private container: Phaser.GameObjects.DOMElement | null = null;
  private rules: string[];
  private onChange?: (rules: string[]) => void;

  constructor(scene: Phaser.Scene, config: RulesEditorConfig) {
    this.scene = scene;
    this.config = config;
    this.rules = config.initialRules ? [...config.initialRules] : [...DEFAULT_RULES];
    this.onChange = config.onChange;
  }

  create(): Phaser.GameObjects.DOMElement {
    const html = this.generateHTML();
    this.container = this.scene.add.dom(this.config.x, this.config.y).createFromHTML(html).setOrigin(0, 0).setDepth(Depth.UI_MODAL_CONTENT);
    this.setupEventListeners();
    return this.container;
  }

  private generateHTML(): string {
    const templateButtons = RULE_TEMPLATES.map(
      (t) => `
      <button class="template-btn" data-template-id="${t.id}" title="${t.description}" style="
        padding: 6px 12px;
        background: #1a2a3a;
        border: 1px solid ${THEME.border};
        border-radius: 6px;
        color: ${THEME.text};
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
      ">${t.name}</button>
    `
    ).join('');

    const rulesHtml = this.rules
      .map(
        (rule, i) => `
        <div class="rule-item" data-index="${i}" style="
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px 12px;
          background: ${THEME.inputBg};
          border: 1px solid ${THEME.border};
          border-radius: 6px;
          margin-bottom: 8px;
        ">
          <span class="rule-number" style="
            color: ${THEME.accent};
            font-size: 11px;
            min-width: 20px;
          ">${i + 1}.</span>
          <span class="rule-text" style="flex: 1; color: ${THEME.text}; font-size: 12px; line-height: 1.4;">
            ${this.escapeHtml(rule)}
          </span>
          <button class="edit-rule-btn" data-index="${i}" style="
            background: transparent;
            border: none;
            color: ${THEME.textMuted};
            cursor: pointer;
            font-size: 11px;
            padding: 2px 6px;
          ">编辑</button>
          <button class="remove-rule-btn" data-index="${i}" style="
            background: transparent;
            border: none;
            color: #ff6666;
            cursor: pointer;
            font-size: 11px;
            padding: 2px 6px;
          ">删除</button>
        </div>
      `
      )
      .join('');

    return `
      <div class="rules-editor" style="
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
            规则模板 (快速选择)
          </label>
          <div class="template-buttons" style="display: flex; flex-wrap: wrap; gap: 8px;">
            ${templateButtons}
          </div>
        </div>

        <div class="section" style="margin-bottom: 16px;">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 8px;">
            当前规则 (<span id="rules-count">${this.rules.length}</span>条)
          </label>
          <div id="rules-list">
            ${rulesHtml || '<span style="color: ' + THEME.textMuted + '; font-size: 12px;">暂无规则</span>'}
          </div>
        </div>

        <div class="section">
          <label style="display: block; font-size: 11px; color: ${THEME.textMuted}; margin-bottom: 6px;">
            添加新规则
          </label>
          <div style="display: flex; gap: 8px;">
            <input type="text" id="new-rule-input" placeholder="输入新规则..." style="
              flex: 1;
              padding: 8px 12px;
              background: ${THEME.inputBg};
              border: 1px solid ${THEME.border};
              border-radius: 6px;
              color: ${THEME.text};
              font-size: 12px;
            " />
            <button id="add-rule-btn" style="
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

        <div class="section" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid ${THEME.border};">
          <button id="clear-all-btn" style="
            padding: 6px 12px;
            background: transparent;
            border: 1px solid #ff6666;
            border-radius: 6px;
            color: #ff6666;
            font-size: 11px;
            cursor: pointer;
          ">清空所有规则</button>
        </div>
      </div>
    `;
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;

    node.querySelectorAll('.template-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const templateId = (e.target as HTMLElement).dataset.templateId;
        if (templateId) {
          this.applyTemplate(templateId);
        }
      });

      btn.addEventListener('mouseenter', (e) => {
        (e.target as HTMLElement).style.borderColor = THEME.accent;
        (e.target as HTMLElement).style.color = THEME.accent;
      });

      btn.addEventListener('mouseleave', (e) => {
        (e.target as HTMLElement).style.borderColor = THEME.border;
        (e.target as HTMLElement).style.color = THEME.text;
      });
    });

    const rulesList = node.querySelector('#rules-list') as HTMLElement;
    const newRuleInput = node.querySelector('#new-rule-input') as HTMLInputElement;
    const addRuleBtn = node.querySelector('#add-rule-btn') as HTMLButtonElement;
    const clearAllBtn = node.querySelector('#clear-all-btn') as HTMLButtonElement;

    addRuleBtn?.addEventListener('click', () => {
      const rule = newRuleInput?.value.trim();
      if (rule) {
        this.rules.push(rule);
        newRuleInput.value = '';
        this.refreshRulesList();
        this.notifyChange();
      }
    });

    newRuleInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        addRuleBtn?.click();
      }
    });

    clearAllBtn?.addEventListener('click', () => {
      if (confirm('确定要清空所有规则吗？')) {
        this.rules = [];
        this.refreshRulesList();
        this.notifyChange();
      }
    });

    rulesList?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const index = parseInt(target.dataset.index || '0', 10);

      if (target.classList.contains('remove-rule-btn')) {
        this.rules.splice(index, 1);
        this.refreshRulesList();
        this.notifyChange();
      } else if (target.classList.contains('edit-rule-btn')) {
        this.editRule(index);
      }
    });
  }

  private applyTemplate(templateId: string): void {
    const template = RULE_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;

    for (const rule of template.rules) {
      if (!this.rules.includes(rule)) {
        this.rules.push(rule);
      }
    }

    this.refreshRulesList();
    this.notifyChange();
  }

  private editRule(index: number): void {
    const currentRule = this.rules[index];
    const newRule = prompt('编辑规则:', currentRule);

    if (newRule !== null && newRule.trim()) {
      this.rules[index] = newRule.trim();
      this.refreshRulesList();
      this.notifyChange();
    }
  }

  private refreshRulesList(): void {
    const node = this.container?.node as HTMLElement;
    const rulesList = node?.querySelector('#rules-list') as HTMLElement;
    const rulesCount = node?.querySelector('#rules-count') as HTMLElement;

    if (rulesCount) {
      rulesCount.textContent = this.rules.length.toString();
    }

    if (!rulesList) return;

    if (this.rules.length === 0) {
      rulesList.innerHTML = `<span style="color: ${THEME.textMuted}; font-size: 12px;">暂无规则</span>`;
      return;
    }

    rulesList.innerHTML = this.rules
      .map(
        (rule, i) => `
        <div class="rule-item" data-index="${i}" style="
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px 12px;
          background: ${THEME.inputBg};
          border: 1px solid ${THEME.border};
          border-radius: 6px;
          margin-bottom: 8px;
        ">
          <span class="rule-number" style="
            color: ${THEME.accent};
            font-size: 11px;
            min-width: 20px;
          ">${i + 1}.</span>
          <span class="rule-text" style="flex: 1; color: ${THEME.text}; font-size: 12px; line-height: 1.4;">
            ${this.escapeHtml(rule)}
          </span>
          <button class="edit-rule-btn" data-index="${i}" style="
            background: transparent;
            border: none;
            color: ${THEME.textMuted};
            cursor: pointer;
            font-size: 11px;
            padding: 2px 6px;
          ">编辑</button>
          <button class="remove-rule-btn" data-index="${i}" style="
            background: transparent;
            border: none;
            color: #ff6666;
            cursor: pointer;
            font-size: 11px;
            padding: 2px 6px;
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
    this.onChange?.(this.getRules());
  }

  getRules(): string[] {
    return [...this.rules];
  }

  setRules(rules: string[]): void {
    this.rules = [...rules];
    this.refreshRulesList();
  }

  addTemplate(templateId: string): void {
    this.applyTemplate(templateId);
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (this.rules.length === 0) {
      errors.push('至少需要添加一条规则');
    }

    for (const rule of this.rules) {
      if (!rule.trim()) {
        errors.push('规则不能为空');
        break;
      }
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

export default RulesEditor;
