import Phaser from 'phaser';
import { Depth } from '@/design-system/tokens/depth';
import type { StratixSoulConfig, SkillTreeState } from '@/stratix-core/stratix-protocol';
import type { SavedCharacter } from '../types';
import { SkillTree } from '../core/SkillTree';
import { SKILL_TREE_CONFIG, SKILL_CATEGORIES } from '../config/skillTreeConfig';
import { SOUL_TEMPLATES, DEFAULT_SOUL, type SoulTemplate } from '../config/soulTemplates';
import { RULE_TEMPLATES, DEFAULT_RULES } from '../config/ruleTemplates';
import { getLightweightAgencyTemplatesByDomain, getDomainDisplayName, AGENCY_DOMAIN_NAMES } from '../config/agencyAgents';
import { getButtonInlineStyles } from './_buttonStyles';
import { sharedSkillStore } from '../core/SharedSkillStore';
import { SKILLHUB_SKILLS, SKILL_CATEGORY_CONFIG, EVOLUTION_PROMPT, type SkillCategory, type SkillHubSkill } from '../config/skillHubConfig';
import { renderTemplatePrompt } from '../core/SoulTemplateRenderer';

export interface AgentConfigPanelConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  character: SavedCharacter;
  onComplete?: (config: AgentFullConfig) => void;
  onBack?: () => void;
}

export interface AgentFullConfig {
  soul?: StratixSoulConfig;
  rules?: string[];
  skillTree?: SkillTreeState;
  attributes?: Record<string, number>;
  renderedPrompt?: string;  // 渲染后的最终提示词
  rawContent?: string;      // Raw content for agency templates
}

const THEME = {
  bg: 'var(--ds-bg-secondary)',
  border: 'var(--ds-border)',
  accent: 'var(--ds-brand-primary)',
  text: 'var(--ds-text-primary)',
  textMuted: 'var(--ds-text-muted)',
  inputBg: 'var(--ds-bg-tertiary)',
  activeTab: 'var(--ds-brand-secondary)',
  success: 'var(--ds-status-success)',
  danger: 'var(--ds-status-danger)',
  textInverse: 'var(--ds-text-inverse)',
};

type TabKey = 'soul' | 'rules' | 'skills';
type SkillsSubTab = 'installed' | 'learned' | 'browse' | 'talent';

const ATTRIBUTE_LABELS_MAP: Record<string, string> = {
  health: '生命',
  attack: '攻击',
  defense: '防御',
  speed: '速度',
  mana: '魔法',
  critChance: '暴击率',
  critDamage: '暴击伤害',
  blockChance: '格挡',
  dodgeChance: '闪避',
  armor: '护甲',
  regen: '回复',
  manaRegen: '魔回复',
  magicDamage: '魔伤',
};

export class AgentConfigPanel {
  private scene: Phaser.Scene;
  private config: AgentConfigPanelConfig;
  private container: Phaser.GameObjects.DOMElement | null = null;
  private currentTab: TabKey = 'soul';
  private currentSkillsSubTab: SkillsSubTab = 'installed';
  private isEditingPrompt: boolean = false;

  private skillTree: SkillTree;

  private soul: StratixSoulConfig;
  private rules: string[];
  private attributes: Record<string, number> = {};

  // SkillHub state
  private skillSearchQuery: string = '';
  private skillSearchResults: SkillHubSkill[] = [];
  private selectedCategory: SkillCategory | 'all' = 'all';

  // Soul template state
  private selectedTemplateId: string | null = null;
  private selectedRawContent: string = '';

  constructor(scene: Phaser.Scene, config: AgentConfigPanelConfig) {
    this.scene = scene;
    this.config = config;

    this.soul = {
      identity: config.character.soul?.identity || DEFAULT_SOUL.identity,
      goals: config.character.soul?.goals || [...DEFAULT_SOUL.goals],
      personality: config.character.soul?.personality || DEFAULT_SOUL.personality,
    };
    this.rules = config.character.rules?.length ? [...config.character.rules] : [...DEFAULT_RULES];

    this.skillTree = new SkillTree(SKILL_TREE_CONFIG);
    if (config.character.skillTree) {
      this.skillTree.setState(config.character.skillTree);
    }
    this.attributes = this.skillTree.calculateAttributes();
  }

  create(): Phaser.GameObjects.DOMElement {
    const html = this.generateHTML();

    this.container = this.scene.add.dom(
      this.config.x,
      this.config.y
    ).createFromHTML(html).setOrigin(0, 0).setDepth(Depth.UI_MODAL_CONTENT);

    this.setupEventListeners();
    this.showTab('soul');
    return this.container;
  }

  private generateHTML(): string {
    return `
      <div class="agent-config-panel" style="
        width: ${this.config.width}px;
        height: ${this.config.height}px;
        background: ${THEME.bg};
        border: 1px solid ${THEME.border};
        border-radius: 8px;
        font-family: system-ui, -apple-system, sans-serif;
        color: ${THEME.text};
        display: flex;
        flex-direction: column;
        overflow: hidden;
        pointer-events: auto;
      ">
        <div class="tabs" style="
          display: flex;
          border-bottom: 1px solid ${THEME.border};
          background: var(--ds-bg-primary);
        ">
          <button class="tab-btn" data-tab="soul" style="
            flex: 1;
            padding: 12px 16px;
            background: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            color: ${THEME.textMuted};
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
          ">身份 SOUL</button>
          <button class="tab-btn" data-tab="rules" style="
            flex: 1;
            padding: 12px 16px;
            background: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            color: ${THEME.textMuted};
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
          ">规则 RULES</button>
          <button class="tab-btn" data-tab="skills" style="
            flex: 1;
            padding: 12px 16px;
            background: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            color: ${THEME.textMuted};
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
          ">技能 SKILLS</button>
        </div>

        <div class="tab-content" style="
          flex: 1;
          position: relative;
          overflow: hidden;
        ">
          <div id="tab-soul" class="tab-panel" style="
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            padding: 12px;
            display: none;
            overflow-y: auto;
          "></div>
          <div id="tab-rules" class="tab-panel" style="
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            padding: 12px;
            display: none;
            overflow-y: auto;
          "></div>
          <div id="tab-skills" class="tab-panel" style="
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            padding: 12px;
            display: none;
            overflow-y: auto;
          "></div>
        </div>

        <div class="attributes-bar" style="
          padding: 8px 16px;
          background: var(--ds-bg-primary);
          border-top: 1px solid ${THEME.border};
          display: flex;
          align-items: center;
          gap: 12px;
          min-height: 36px;
        ">
          <span style="font-size: 11px; color: ${THEME.textMuted};">属性:</span>
          <div id="attributes-display" style="
            display: flex;
            gap: 12px;
            font-size: 11px;
            flex-wrap: wrap;
          ">
            <span style="color: ${THEME.textMuted};">选择技能以查看属性加成</span>
          </div>
        </div>

        <div class="actions" style="
          padding: 12px 16px;
          background: var(--ds-bg-primary);
          border-top: 1px solid ${THEME.border};
          display: flex;
          justify-content: space-between;
          gap: 12px;
        ">
          <button id="back-btn" style="${getButtonInlineStyles('ghost')}">← 返回</button>
          <button id="complete-btn" style="${getButtonInlineStyles('success')}">完成配置 ✓</button>
        </div>
      </div>
    `;
  }

  private setupEventListeners(): void {
    const node = this.container?.node as HTMLElement;
    if (!node) return;

    // 阻止所有点击事件冒泡到 canvas
    node.addEventListener('click', (e) => e.stopPropagation());
    node.addEventListener('pointerdown', (e) => e.stopPropagation());
    node.addEventListener('pointerup', (e) => e.stopPropagation());
    node.addEventListener('pointermove', (e) => e.stopPropagation());

    node.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const tab = (e.target as HTMLElement).dataset.tab as TabKey;
        if (tab) {
          this.showTab(tab);
        }
      });
    });

    const backBtn = node.querySelector('#back-btn') as HTMLButtonElement;
    const completeBtn = node.querySelector('#complete-btn') as HTMLButtonElement;

    backBtn?.addEventListener('click', () => {
      this.config.onBack?.();
    });

    completeBtn?.addEventListener('click', () => {
      this.handleComplete();
    });
  }

  private showTab(tab: TabKey): void {
    this.currentTab = tab;

    const node = this.container?.node as HTMLElement;
    if (!node) return;

    node.querySelectorAll('.tab-btn').forEach((btn) => {
      const btnTab = (btn as HTMLElement).dataset.tab;
      const isActive = btnTab === tab;
      (btn as HTMLElement).style.color = isActive ? THEME.accent : THEME.textMuted;
      (btn as HTMLElement).style.borderBottomColor = isActive ? THEME.accent : 'transparent';
      (btn as HTMLElement).style.background = isActive ? THEME.activeTab : 'transparent';
    });

    node.querySelectorAll('.tab-panel').forEach((panel) => {
      (panel as HTMLElement).style.display = 'none';
    });

    const activePanel = node.querySelector(`#tab-${tab}`) as HTMLElement;
    if (activePanel) {
      activePanel.style.display = 'block';
      this.renderTabContent(tab, activePanel);
    }
  }

  private renderTabContent(tab: TabKey, panel: HTMLElement): void {
    switch (tab) {
      case 'soul':
        this.renderSoulContent(panel);
        break;
      case 'rules':
        this.renderRulesContent(panel);
        break;
      case 'skills':
        this.renderSkillsContent(panel);
        break;
    }
  }

  private renderSoulContent(panel: HTMLElement): void {
    // 按 domain 分组 - 本地模板
    const localTemplates = SOUL_TEMPLATES;

    // 获取 agency 模板
    const agencyTemplatesByDomain = getLightweightAgencyTemplatesByDomain();

    // 生成带 optgroup 的 HTML
    let optionsHtml = '<option value="">-- 选择模板 --</option>';

    // 本地模板分组 (用 [L] 前缀)
    const localDomainNames: Record<string, string> = {
      engineering: '工程开发',
      design: '设计',
      marketing: '市场营销',
      sales: '销售',
      product: '产品管理',
      'project-management': '项目管理',
      data: '数据分析',
      support: '客户支持',
      content: '内容创作',
      general: '通用',
    };

    // 按 domain 分组本地模板
    const groupedLocal = new Map<string, SoulTemplate[]>();
    for (const t of localTemplates) {
      const domain = t.domain || 'general';
      if (!groupedLocal.has(domain)) {
        groupedLocal.set(domain, []);
      }
      groupedLocal.get(domain)!.push(t);
    }

    // 输出本地模板 optgroup
    for (const [domain, templates] of groupedLocal) {
      const domainLabel = localDomainNames[domain] || domain;
      optionsHtml += `<optgroup label="[L] ${domainLabel}">`;
      for (const t of templates) {
        optionsHtml += `<option value="${t.id}">${t.name}</option>`;
      }
      optionsHtml += '</optgroup>';
    }

    // 输出 agency 模板 optgroup
    for (const [domain, templates] of agencyTemplatesByDomain) {
      const domainLabel = getDomainDisplayName(domain);
      optionsHtml += `<optgroup label="[A] ${domainLabel}">`;
      for (const t of templates) {
        optionsHtml += `<option value="${t.id}">${t.name}</option>`;
      }
      optionsHtml += '</optgroup>';
    }

    const goalsHtml = this.soul.goals.length === 0
      ? ''
      : this.soul.goals
          .map((goal, i) => {
            const safeGoal = goal ? this.escapeHtml(goal) : '';
            return `
        <div class="goal-item" data-index="${i}" data-goal="${safeGoal}" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
          <span style="display: block; flex: 1; color: var(--ds-text-primary); font-size: 12px; overflow: hidden; text-overflow: ellipsis;">${safeGoal}</span>
          <button class="remove-goal-btn" data-index="${i}" style="${getButtonInlineStyles('danger')}">删除</button>
        </div>
      `;
          })
          .join('');

    panel.innerHTML = `
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
          ${optionsHtml}
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
          <button id="add-goal-btn" style="${getButtonInlineStyles('primary')}">添加</button>
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

      ${this.selectedRawContent ? `
      <div class="section" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid ${THEME.border};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <label style="font-size: 11px; color: ${THEME.textMuted};">
            📄 Raw Content (Agency 模板原文)
          </label>
          <button id="toggle-raw-content-btn" style="${getButtonInlineStyles('ghost')}">收起</button>
        </div>
        <textarea id="soul-raw-content" style="
          width: 100%;
          height: 200px;
          padding: 10px 12px;
          background: ${THEME.inputBg};
          border: 1px solid ${THEME.border};
          border-radius: 6px;
          color: ${THEME.text};
          font-size: 11px;
          font-family: 'SF Mono', 'Monaco', monospace;
          line-height: 1.5;
          resize: vertical;
          box-sizing: border-box;
          white-space: pre-wrap;
        ">${this.escapeHtml(this.selectedRawContent)}</textarea>
      </div>
      ` : ''}

      <div class="section" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid ${THEME.border};">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <label style="font-size: 11px; color: ${THEME.textMuted};">
            System Prompt 预览
          </label>
          <div style="display: flex; gap: 8px;">
            <button id="edit-prompt-btn" style="${getButtonInlineStyles('ghost')}">编辑</button>
            <button id="copy-prompt-btn" style="${getButtonInlineStyles('ghost')}">复制</button>
            <button id="toggle-preview-btn" style="${getButtonInlineStyles('ghost')}">展开</button>
          </div>
        </div>
        <textarea id="prompt-preview" class="prompt-preview" readonly style="
          background: ${THEME.inputBg};
          border: 1px solid ${THEME.border};
          border-radius: 6px;
          padding: 12px;
          font-size: 10px;
          line-height: 1.5;
          width: 100%;
          min-height: 120px;
          resize: vertical;
          white-space: pre-wrap;
          word-break: break-all;
          color: ${THEME.text};
          font-family: 'SF Mono', 'Monaco', monospace;
          box-sizing: border-box;
        ">${this.escapeHtml(this.buildSystemPromptPreview())}</textarea>
      </div>
    `;

    this.setupSoulEventListeners(panel);
  }

  private setupSoulEventListeners(panel: HTMLElement): void {
    const templateSelect = panel.querySelector('#soul-template-select') as HTMLSelectElement;
    const identityInput = panel.querySelector('#soul-identity') as HTMLTextAreaElement;
    const personalityInput = panel.querySelector('#soul-personality') as HTMLTextAreaElement;
    const goalsList = panel.querySelector('#goals-list') as HTMLElement;
    const newGoalInput = panel.querySelector('#new-goal-input') as HTMLInputElement;
    const addGoalBtn = panel.querySelector('#add-goal-btn') as HTMLButtonElement;
    const copyPromptBtn = panel.querySelector('#copy-prompt-btn') as HTMLButtonElement;
    const togglePreviewBtn = panel.querySelector('#toggle-preview-btn') as HTMLButtonElement;
    const editPromptBtn = panel.querySelector('#edit-prompt-btn') as HTMLButtonElement;
    const promptPreview = panel.querySelector('#prompt-preview') as HTMLTextAreaElement;

    templateSelect?.addEventListener('change', (e) => {
      const templateId = (e.target as HTMLSelectElement).value;
      if (templateId) {
        // 先在本地模板中查找
        let template = SOUL_TEMPLATES.find((t) => t.id === templateId);
        // 如果没找到，尝试在 agency 模板中查找
        if (!template) {
          const agencyTemplates = getLightweightAgencyTemplatesByDomain();
          for (const [, templates] of agencyTemplates) {
            template = templates.find((t) => t.id === templateId);
            if (template) break;
          }
        }
        if (template) {
          this.applySoulTemplate(template);
          // 只更新 soul 相关字段，不重新渲染整个面板以保留事件监听器
          const identityInput = panel.querySelector('#soul-identity') as HTMLTextAreaElement;
          const personalityInput = panel.querySelector('#soul-personality') as HTMLTextAreaElement;
          const goalsList = panel.querySelector('#goals-list') as HTMLElement;

          if (identityInput) identityInput.value = this.soul.identity;
          if (personalityInput) personalityInput.value = this.soul.personality;

          // 更新目标列表
          if (goalsList) {
            if (this.soul.goals.length === 0) {
              goalsList.innerHTML = '<span style="color: var(--ds-text-muted); font-size: 12px;">暂无目标</span>';
            } else {
              goalsList.innerHTML = this.soul.goals.map((goal, i) => {
                const safeGoal = goal ? this.escapeHtml(goal) : '';
                return `
                  <div class="goal-item" data-index="${i}" data-goal="${safeGoal}" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                    <span style="display: block; flex: 1; color: var(--ds-text-primary); font-size: 12px; overflow: hidden; text-overflow: ellipsis;">${safeGoal}</span>
                    <button class="remove-goal-btn" data-index="${i}" style="${getButtonInlineStyles('danger')}">删除</button>
                  </div>
                `;
              }).join('');
            }
          }
        }
      }
    });

    identityInput?.addEventListener('input', (e) => {
      this.soul.identity = (e.target as HTMLTextAreaElement).value;
    });

    personalityInput?.addEventListener('input', (e) => {
      this.soul.personality = (e.target as HTMLInputElement).value;
    });

    // Raw content editor for agency templates
    const rawContentInput = panel.querySelector('#soul-raw-content') as HTMLTextAreaElement;
    rawContentInput?.addEventListener('input', (e) => {
      this.selectedRawContent = (e.target as HTMLTextAreaElement).value;
    });

    const toggleRawContentBtn = panel.querySelector('#toggle-raw-content-btn') as HTMLButtonElement;
    toggleRawContentBtn?.addEventListener('click', () => {
      const rawSection = panel.querySelector('#soul-raw-content')?.parentElement;
      if (rawSection) {
        const isHidden = rawSection.getAttribute('data-collapsed') === 'true';
        if (isHidden) {
          (rawSection as HTMLElement).style.display = 'block';
          rawSection.setAttribute('data-collapsed', 'false');
          if (toggleRawContentBtn) toggleRawContentBtn.textContent = '收起';
        } else {
          (rawSection as HTMLElement).style.display = 'none';
          rawSection.setAttribute('data-collapsed', 'true');
          if (toggleRawContentBtn) toggleRawContentBtn.textContent = '展开';
        }
      }
    });

    addGoalBtn?.addEventListener('click', () => {
      const goal = newGoalInput?.value.trim();
      if (goal) {
        this.soul.goals.push(goal);
        newGoalInput.value = '';

        // 直接在 DOM 中添加目标行，不重新渲染整个面板
        const safeGoal = this.escapeHtml(goal);
        const newGoalHtml = `
          <div class="goal-item" data-index="${this.soul.goals.length - 1}" data-goal="${safeGoal}" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span style="display: block; flex: 1; color: var(--ds-text-primary); font-size: 12px; overflow: hidden; text-overflow: ellipsis;">${safeGoal}</span>
            <button class="remove-goal-btn" data-index="${this.soul.goals.length - 1}" style="${getButtonInlineStyles('danger')}">删除</button>
          </div>
        `;
        goalsList.insertAdjacentHTML('beforeend', newGoalHtml);

        // 如果是第一个目标，移除"暂无目标"的提示
        const emptyMsg = goalsList.querySelector('span[style*="暂无目标"]');
        if (emptyMsg) emptyMsg.remove();
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

        // 直接从 DOM 中移除目标行，不重新渲染整个面板
        const goalItems = goalsList.querySelectorAll('.goal-item');
        if (goalItems[index]) {
          goalItems[index].remove();
        }

        // 重新索引剩余的目标项
        goalsList.querySelectorAll('.goal-item').forEach((item, i) => {
          item.setAttribute('data-index', String(i));
          const removeBtn = item.querySelector('.remove-goal-btn');
          if (removeBtn) removeBtn.setAttribute('data-index', String(i));
        });

        // 如果没有目标了，显示"暂无目标"
        if (this.soul.goals.length === 0) {
          goalsList.innerHTML = '<span style="color: var(--ds-text-muted); font-size: 12px;">暂无目标</span>';
        }
      }
    });

    copyPromptBtn?.addEventListener('click', () => {
      const prompt = this.buildSystemPromptPreview();
      navigator.clipboard.writeText(prompt).then(() => {
        copyPromptBtn.textContent = '已复制!';
        setTimeout(() => {
          if (copyPromptBtn) copyPromptBtn.textContent = '复制';
        }, 1500);
      });
    });

    editPromptBtn?.addEventListener('click', () => {
      if (this.isEditingPrompt) {
        // 保存编辑内容
        this.isEditingPrompt = false;
        if (editPromptBtn) editPromptBtn.textContent = '编辑';
        if (promptPreview) promptPreview.readOnly = true;
      } else {
        // 进入编辑模式
        this.isEditingPrompt = true;
        if (editPromptBtn) editPromptBtn.textContent = '保存';
        if (promptPreview) promptPreview.readOnly = false;
        promptPreview?.focus();
      }
    });

    togglePreviewBtn?.addEventListener('click', () => {
      const isCollapsed = promptPreview?.classList.contains('collapsed');
      if (promptPreview) {
        if (isCollapsed) {
          promptPreview.classList.remove('collapsed');
          promptPreview.style.maxHeight = '300px';
          if (togglePreviewBtn) togglePreviewBtn.textContent = '收起';
        } else {
          promptPreview.classList.add('collapsed');
          promptPreview.style.maxHeight = '120px';
          if (togglePreviewBtn) togglePreviewBtn.textContent = '展开';
        }
      }
    });
  }

  private applySoulTemplate(template: SoulTemplate): void {
    // soul 可能是 undefined（如 agency 模板），使用空默认值
    const soul = template.soul || { identity: '', goals: [], personality: '' };
    this.soul = {
      identity: soul.identity || '',
      goals: soul.goals ? [...soul.goals] : [],
      personality: soul.personality || '',
    };
    this.selectedTemplateId = template.id;
    this.selectedRawContent = template.rawContent || '';
  }

  private buildSystemPromptPreview(): string {
    const installedSkills = sharedSkillStore.getInstalledSkillsWithDetails();
    const learnedSkills = sharedSkillStore.getLearnedSkillsWithDetails();

    const installedList = installedSkills.length > 0
      ? installedSkills.map(s => `  - ${s.name}: ${s.description}`).join('\n')
      : '  (暂无已安装技能)';

    const learnedList = learnedSkills.length > 0
      ? learnedSkills.map(s => `  - ${s.name} (Lv.${s.level}): ${s.description}`).join('\n')
      : '  (暂无已学习技能)';

    // Get evolution prompt from selected template (local only, agency uses default), fallback to EVOLUTION_PROMPT
    const evolutionPrompt = this.selectedTemplateId
      ? (SOUL_TEMPLATES.find(t => t.id === this.selectedTemplateId)?.evolutionPrompt
        || EVOLUTION_PROMPT)
      : EVOLUTION_PROMPT;

    // Use renderer to build prompt from soul config
    const soulPrompt = renderTemplatePrompt(this.soul, evolutionPrompt);

    return `${soulPrompt}

【已安装技能】
${installedList}

【已学习技能】
${learnedList}`;
  }

  private renderRulesContent(panel: HTMLElement): void {
    const templateButtons = RULE_TEMPLATES.map(
      (t) => `
      <button class="template-btn" data-template-id="${t.id}" title="${t.description}" style="${getButtonInlineStyles('tertiary')}">${t.name}</button>
    `
    ).join('');

    const rulesHtml = this.rules
      .map((rule, i) => `
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
          <button class="edit-rule-btn" data-index="${i}" style="${getButtonInlineStyles('ghost')}">编辑</button>
          <button class="remove-rule-btn" data-index="${i}" style="${getButtonInlineStyles('danger')}">删除</button>
        </div>
      `).join('');

    panel.innerHTML = `
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
          <button id="add-rule-btn" style="${getButtonInlineStyles('primary')}">添加</button>
        </div>
      </div>

      <div class="section" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid ${THEME.border};">
        <button id="clear-all-btn" style="${getButtonInlineStyles('danger')}">清空所有规则</button>
      </div>
    `;

    this.setupRulesEventListeners(panel);
  }

  private setupRulesEventListeners(panel: HTMLElement): void {
    const rulesList = panel.querySelector('#rules-list') as HTMLElement;
    const newRuleInput = panel.querySelector('#new-rule-input') as HTMLInputElement;
    const addRuleBtn = panel.querySelector('#add-rule-btn') as HTMLButtonElement;
    const clearAllBtn = panel.querySelector('#clear-all-btn') as HTMLButtonElement;

    panel.querySelectorAll('.template-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const templateId = (e.target as HTMLElement).dataset.templateId;
        if (templateId) {
          this.applyRulesTemplate(templateId);
          this.renderRulesContent(panel);
        }
      });
    });

    addRuleBtn?.addEventListener('click', () => {
      const rule = newRuleInput?.value.trim();
      if (rule) {
        this.rules.push(rule);
        newRuleInput.value = '';
        this.renderRulesContent(panel);
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
        this.renderRulesContent(panel);
      }
    });

    rulesList?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const index = parseInt(target.dataset.index || '0', 10);

      if (target.classList.contains('remove-rule-btn')) {
        this.rules.splice(index, 1);
        this.renderRulesContent(panel);
      } else if (target.classList.contains('edit-rule-btn')) {
        this.editRule(index, panel);
      }
    });
  }

  private applyRulesTemplate(templateId: string): void {
    const template = RULE_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;

    for (const rule of template.rules) {
      if (!this.rules.includes(rule)) {
        this.rules.push(rule);
      }
    }
  }

  private editRule(index: number, panel: HTMLElement): void {
    const currentRule = this.rules[index];
    const newRule = prompt('编辑规则:', currentRule);

    if (newRule !== null && newRule.trim()) {
      this.rules[index] = newRule.trim();
      this.renderRulesContent(panel);
    }
  }

  private renderSkillsContent(panel: HTMLElement): void {
    // Render sub-tabs
    const subTabs: { key: SkillsSubTab; label: string; count?: number }[] = [
      { key: 'installed', label: '已安装', count: sharedSkillStore.getStats().installed },
      { key: 'learned', label: '已学习', count: sharedSkillStore.getStats().learned },
      { key: 'browse', label: '浏览商店' },
      { key: 'talent', label: '天赋树' },
    ];

    const subTabsHtml = subTabs.map(tab => {
      const countHtml = tab.count !== undefined ? ` <span style="opacity: 0.6;">(${tab.count})</span>` : '';
      const isActive = this.currentSkillsSubTab === tab.key;
      return `
        <button class="skills-sub-tab" data-subtab="${tab.key}" style="
          padding: 6px 12px;
          background: ${isActive ? THEME.accent : 'transparent'};
          color: ${isActive ? THEME.textInverse : THEME.textMuted};
          border: none;
          border-radius: 4px;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.2s;
        ">${tab.label}${countHtml}</button>
      `;
    }).join('');

    panel.innerHTML = `
      <div style="
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 8px;
      ">
        <div class="skills-sub-tabs" style="
          display: flex;
          gap: 6px;
          padding: 8px;
          background: var(--ds-bg-tertiary);
          border-radius: 6px;
          flex-wrap: wrap;
        ">
          ${subTabsHtml}
        </div>
        <div class="skills-sub-content" style="
          flex: 1;
          overflow-y: auto;
          background: var(--ds-bg-secondary);
          border: 1px solid var(--ds-border);
          border-radius: 6px;
          padding: 12px;
        ">
          <div id="skills-sub-content-inner"></div>
        </div>
      </div>
    `;

    this.setupSkillsSubTabListeners(panel);
    this.renderSkillsSubContent(panel);
  }

  private renderSkillsSubContent(panel: HTMLElement): void {
    const inner = panel.querySelector('#skills-sub-content-inner') as HTMLElement;
    if (!inner) return;

    switch (this.currentSkillsSubTab) {
      case 'installed':
        this.renderInstalledSkills(inner);
        break;
      case 'learned':
        this.renderLearnedSkills(inner);
        break;
      case 'browse':
        this.renderBrowseSkills(inner);
        break;
      case 'talent':
        this.renderTalentTree(inner);
        break;
    }
  }

  private renderInstalledSkills(panel: HTMLElement): void {
    const skills = sharedSkillStore.getInstalledSkillsWithDetails();
    const stats = sharedSkillStore.getStats();

    if (skills.length === 0) {
      panel.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: ${THEME.textMuted};">
          <div style="font-size: 32px; margin-bottom: 12px;">📦</div>
          <div style="font-size: 13px;">暂无已安装技能</div>
          <div style="font-size: 11px; margin-top: 8px;">从"浏览商店"安装技能</div>
        </div>
      `;
      return;
    }

    const skillsHtml = skills.map(skill => {
      const catConfig = SKILL_CATEGORY_CONFIG[skill.category];
      return `
        <div class="skill-card" data-skill-id="${skill.skillId}" style="
          display: flex;
          gap: 12px;
          padding: 12px;
          background: var(--ds-bg-tertiary);
          border: 1px solid var(--ds-border);
          border-radius: 6px;
          margin-bottom: 8px;
        ">
          <div style="
            width: 36px;
            height: 36px;
            background: ${catConfig.color}22;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
          ">📦</div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 12px; font-weight: 500; color: ${THEME.text};">${skill.name}</span>
              <span style="
                font-size: 10px;
                padding: 2px 6px;
                background: ${catConfig.color}22;
                color: ${catConfig.color};
                border-radius: 3px;
              ">${catConfig.name}</span>
            </div>
            <div style="font-size: 11px; color: ${THEME.textMuted};">${skill.description}</div>
            ${skill.mcpTool ? `<div style="font-size: 10px; color: ${THEME.textMuted}; margin-top: 4px;">MCP: ${skill.mcpTool}</div>` : ''}
          </div>
          <button class="uninstall-btn" data-skill-id="${skill.skillId}" style="${getButtonInlineStyles('danger')}">卸载</button>
        </div>
      `;
    }).join('');

    panel.innerHTML = `
      <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 12px; color: ${THEME.textMuted};">已安装 ${skills.length}/${stats.available} 个技能</span>
      </div>
      ${skillsHtml}
    `;

    // Setup uninstall listeners
    panel.querySelectorAll('.uninstall-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const skillId = (e.target as HTMLElement).dataset.skillId;
        if (skillId && confirm('确定要卸载此技能吗？')) {
          sharedSkillStore.uninstallSkill(skillId);
          this.renderSkillsSubContent(panel);
          this.updateAttributesDisplay();
        }
      });
    });
  }

  private renderLearnedSkills(panel: HTMLElement): void {
    const skills = sharedSkillStore.getLearnedSkillsWithDetails();

    if (skills.length === 0) {
      panel.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: ${THEME.textMuted};">
          <div style="font-size: 32px; margin-bottom: 12px;">📚</div>
          <div style="font-size: 13px;">暂无已学习技能</div>
          <div style="font-size: 11px; margin-top: 8px;">Agent 工作后会自动学习新技能</div>
        </div>
      `;
      return;
    }

    const skillsHtml = skills.map(skill => {
      const catConfig = SKILL_CATEGORY_CONFIG[skill.category];
      const levelPercent = (skill.level / 5) * 100;
      return `
        <div class="skill-card" data-skill-id="${skill.skillId}" style="
          display: flex;
          gap: 12px;
          padding: 12px;
          background: var(--ds-bg-tertiary);
          border: 1px solid var(--ds-border);
          border-radius: 6px;
          margin-bottom: 8px;
        ">
          <div style="
            width: 36px;
            height: 36px;
            background: ${catConfig.color}22;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
          ">📚</div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 12px; font-weight: 500; color: ${THEME.text};">${skill.name}</span>
              <span style="
                font-size: 10px;
                padding: 2px 6px;
                background: ${catConfig.color}22;
                color: ${catConfig.color};
                border-radius: 3px;
              ">${catConfig.name}</span>
              <span style="
                font-size: 10px;
                padding: 2px 6px;
                background: ${THEME.success}22;
                color: ${THEME.success};
                border-radius: 3px;
              ">Lv.${skill.level}</span>
            </div>
            <div style="font-size: 11px; color: ${THEME.textMuted};">${skill.description}</div>
            <div style="
              margin-top: 8px;
              height: 4px;
              background: var(--ds-bg-primary);
              border-radius: 2px;
              overflow: hidden;
            ">
              <div style="
                width: ${levelPercent}%;
                height: 100%;
                background: linear-gradient(90deg, ${THEME.accent}, ${THEME.success});
                transition: width 0.3s;
              "></div>
            </div>
            <div style="font-size: 10px; color: ${THEME.textMuted}; margin-top: 4px;">
              经验: ${skill.experience}/50 ${skill.learnedFrom ? `· 来自: ${skill.learnedFrom}` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    panel.innerHTML = `
      <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 12px; color: ${THEME.textMuted};">已学习 ${skills.length} 个技能</span>
        <span style="font-size: 11px; color: ${THEME.textMuted};">技能随使用提升等级</span>
      </div>
      ${skillsHtml}
    `;
  }

  private renderBrowseSkills(panel: HTMLElement): void {
    const stats = sharedSkillStore.getStats();
    const categories: (SkillCategory | 'all')[] = ['all', 'file', 'code', 'data', 'content', 'mcp', 'collab'];

    // Get filtered skills
    const filteredSkills = this.selectedCategory === 'all'
      ? (this.skillSearchQuery ? sharedSkillStore.searchSkills(this.skillSearchQuery) : SKILLHUB_SKILLS)
      : SKILLHUB_SKILLS.filter(s => s.category === this.selectedCategory);

    const categoryButtons = categories.map(cat => {
      const config = cat === 'all' ? { name: '全部', icon: '📦', color: THEME.accent } : SKILL_CATEGORY_CONFIG[cat];
      const isActive = this.selectedCategory === cat;
      return `
        <button class="category-btn" data-category="${cat}" style="
          padding: 4px 10px;
          background: ${isActive ? config.color : 'var(--ds-bg-tertiary)'};
          color: ${isActive ? THEME.textInverse : THEME.textMuted};
          border: none;
          border-radius: 4px;
          font-size: 10px;
          cursor: pointer;
          transition: all 0.2s;
        ">${config.icon} ${config.name}</button>
      `;
    }).join('');

    const skillsHtml = filteredSkills.map(skill => {
      const catConfig = SKILL_CATEGORY_CONFIG[skill.category];
      const isInstalled = sharedSkillStore.isInstalled(skill.skillId);
      return `
        <div class="skill-card" data-skill-id="${skill.skillId}" style="
          display: flex;
          gap: 12px;
          padding: 12px;
          background: var(--ds-bg-tertiary);
          border: 1px solid ${isInstalled ? THEME.success : 'var(--ds-border)'};
          border-radius: 6px;
          margin-bottom: 8px;
          opacity: ${isInstalled ? 0.7 : 1};
        ">
          <div style="
            width: 36px;
            height: 36px;
            background: ${catConfig.color}22;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
          ">${catConfig.icon}</div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
              <span style="font-size: 12px; font-weight: 500; color: ${THEME.text};">${skill.name}</span>
              <span style="
                font-size: 10px;
                padding: 2px 6px;
                background: ${catConfig.color}22;
                color: ${catConfig.color};
                border-radius: 3px;
              ">${catConfig.name}</span>
              ${isInstalled ? `<span style="
                font-size: 10px;
                padding: 2px 6px;
                background: ${THEME.success}22;
                color: ${THEME.success};
                border-radius: 3px;
              ">已安装</span>` : ''}
            </div>
            <div style="font-size: 11px; color: ${THEME.textMuted};">${skill.description}</div>
            ${skill.mcpTool ? `<div style="font-size: 10px; color: ${THEME.textMuted}; margin-top: 4px;">MCP: ${skill.mcpTool}</div>` : ''}
          </div>
          <button class="install-btn" data-skill-id="${skill.skillId}" style="
            ${isInstalled ? 'opacity: 0.5; cursor: not-allowed;' : ''}
            ${getButtonInlineStyles(isInstalled ? 'disabled' : 'primary')}
          " ${isInstalled ? 'disabled' : ''}>
            ${isInstalled ? '已安装' : '安装'}
          </button>
        </div>
      `;
    }).join('');

    panel.innerHTML = `
      <div style="margin-bottom: 12px;">
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <input type="text" id="skill-search-input" placeholder="搜索技能..." value="${this.escapeHtml(this.skillSearchQuery)}" style="
            flex: 1;
            padding: 8px 12px;
            background: var(--ds-bg-primary);
            border: 1px solid var(--ds-border);
            border-radius: 6px;
            color: ${THEME.text};
            font-size: 12px;
            outline: none;
          " />
        </div>
        <div class="category-filters" style="display: flex; flex-wrap: wrap; gap: 6px;">
          ${categoryButtons}
        </div>
      </div>
      <div class="browse-skills-list" style="max-height: 300px; overflow-y: auto;">
        ${skillsHtml || '<div style="text-align: center; padding: 20px; color: ' + THEME.textMuted + ';">未找到匹配的技能</div>'}
      </div>
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--ds-border); display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; color: ${THEME.textMuted};">共 ${filteredSkills.length} 个技能</span>
        <span style="font-size: 11px; color: ${THEME.textMuted};">已安装: ${stats.installed} / 可用: ${stats.available}</span>
      </div>
    `;

    // Setup search input
    const searchInput = panel.querySelector('#skill-search-input') as HTMLInputElement;
    searchInput?.addEventListener('input', (e) => {
      this.skillSearchQuery = (e.target as HTMLInputElement).value;
      this.renderSkillsSubContent(panel);
    });

    // Setup category buttons
    panel.querySelectorAll('.category-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const category = (e.target as HTMLElement).dataset.category as SkillCategory | 'all';
        this.selectedCategory = category;
        this.renderSkillsSubContent(panel);
      });
    });

    // Setup install buttons
    panel.querySelectorAll('.install-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const skillId = (e.target as HTMLElement).dataset.skillId;
        if (skillId) {
          sharedSkillStore.installSkill(skillId);
          this.renderSkillsSubContent(panel);
          this.updateAttributesDisplay();
        }
      });
    });
  }

  private renderTalentTree(panel: HTMLElement): void {
    // This is the original RPG skill tree
    const nodes = this.skillTree.getAllNodes();
    const nodeWidth = 80;
    const nodeHeight = 60;
    const spacing = 100;

    const nodesHtml = nodes.map(node => {
      const category = this.getNodeCategory(node);
      const categoryConfig = (SKILL_CATEGORIES as any)[category] ?? SKILL_CATEGORIES.utility;
      const x = node.position.x * spacing + 40;
      const y = node.position.y * spacing + 60;
      const isSelected = this.skillTree.isNodeSelected(node.nodeId);
      const isUnlocked = this.skillTree.isNodeUnlocked(node.nodeId);

      return `
        <div class="skill-node ${isSelected ? 'selected' : ''} ${!isUnlocked ? 'locked' : ''}"
             data-node-id="${node.nodeId}"
             style="
               left: ${x}px;
               top: ${y}px;
               width: ${nodeWidth}px;
               height: ${nodeHeight}px;
               background: linear-gradient(135deg, ${categoryConfig.color}22, ${categoryConfig.color}44);
               border: 2px solid ${categoryConfig.color};
               position: absolute;
               border-radius: 8px;
               display: flex;
               flex-direction: column;
               align-items: center;
               justify-content: center;
               cursor: ${isUnlocked ? 'pointer' : 'not-allowed'};
               transition: all 0.2s;
               user-select: none;
               opacity: ${isUnlocked ? 1 : 0.4};
             ">
          <div class="node-icon" style="font-size: 16px; margin-bottom: 2px;">${categoryConfig.icon}</div>
          <div class="node-name" style="font-size: 10px; text-align: center; line-height: 1.2;">${node.name}</div>
        </div>
      `;
    }).join('');

    const connectionsHtml = this.generateConnections(nodes, spacing);

    panel.innerHTML = `
      <div style="
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
      ">
        <div class="header" style="
          padding: 10px;
          background: var(--ds-bg-tertiary);
          border-radius: 6px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        ">
          <span style="font-size: 12px; font-weight: 500; color: ${THEME.text};">天赋树</span>
          <span class="points-info" style="font-size: 11px; color: ${THEME.textMuted};">
            可用点数: <span class="remaining-points">${this.skillTree.getRemainingPoints()}</span>/${this.skillTree.getMaxPoints()}
          </span>
        </div>
        <div class="tree-content" style="
          flex: 1;
          position: relative;
          overflow: auto;
          padding: 20px;
          min-height: 250px;
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
      </div>
    `;

    // Setup talent tree click listeners
    panel.querySelectorAll('.skill-node').forEach(nodeEl => {
      nodeEl.addEventListener('click', (e) => {
        const nodeId = (e.currentTarget as HTMLElement).dataset.nodeId;
        if (!nodeId) return;

        if (this.skillTree.isNodeSelected(nodeId)) {
          this.skillTree.deselectNode(nodeId);
        } else {
          const { canSelect, reason } = this.skillTree.canSelectNode(nodeId);
          if (canSelect) {
            this.skillTree.selectNode(nodeId);
          } else {
            alert(reason || '无法选择');
          }
        }

        this.attributes = this.skillTree.calculateAttributes();
        this.updateAttributesDisplay();
        this.renderSkillsSubContent(panel);
      });
    });
  }

  private setupSkillsSubTabListeners(panel: HTMLElement): void {
    panel.querySelectorAll('.skills-sub-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const subtab = (e.target as HTMLElement).dataset.subtab as SkillsSubTab;
        if (subtab) {
          this.currentSkillsSubTab = subtab;
          this.renderSkillsContent(panel);
        }
      });
    });
  }

  private generateConnections(nodes: any[], spacing: number): string {
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
                 x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                 stroke="var(--ds-border)" stroke-width="2"/>`
        );
      }
    }

    return lines.join('');
  }

  private getNodeCategory(node: any): string {
    const attrs = Object.keys(node.attributes);
    if (attrs.some(a => a.includes('attack') || a.includes('damage'))) return 'combat';
    if (attrs.some(a => a.includes('defense') || a.includes('armor') || a.includes('block'))) return 'defense';
    if (attrs.some(a => a.includes('speed') || a.includes('dodge'))) return 'mobility';
    if (attrs.some(a => a.includes('mana') || a.includes('magic'))) return 'magic';
    return 'utility';
  }

  private setupSkillsEventListeners(panel: HTMLElement): void {
    panel.querySelectorAll('.skill-node').forEach(nodeEl => {
      nodeEl.addEventListener('click', (e) => {
        const nodeId = (e.currentTarget as HTMLElement).dataset.nodeId;
        if (!nodeId) return;

        if (this.skillTree.isNodeSelected(nodeId)) {
          this.skillTree.deselectNode(nodeId);
        } else {
          const { canSelect, reason } = this.skillTree.canSelectNode(nodeId);
          if (canSelect) {
            this.skillTree.selectNode(nodeId);
          } else {
            alert(reason || '无法选择');
          }
        }

        this.attributes = this.skillTree.calculateAttributes();
        this.updateAttributesDisplay();
        this.renderSkillsContent(panel);
      });
    });
  }

  private updateAttributesDisplay(): void {
    const node = this.container?.node as HTMLElement;
    const display = node?.querySelector('#attributes-display') as HTMLElement;

    if (!display) return;

    if (Object.keys(this.attributes).length === 0) {
      display.innerHTML = `<span style="color: ${THEME.textMuted};">选择技能以查看属性加成</span>`;
      return;
    }

    display.innerHTML = Object.entries(this.attributes)
      .map(([key, value]) => {
        const label = ATTRIBUTE_LABELS_MAP[key] || key;
        return `<span style="color: ${THEME.accent};">${label}: +${value}</span>`;
      })
      .join('');
  }

  private escapeHtml(text: string): string {
    const div = { innerHTML: '' } as HTMLElement;
    div.textContent = text;
    return div.innerHTML;
  }

  private handleComplete(): void {
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

    // Check if at least 1 skill is installed
    const installedCount = sharedSkillStore.getStats().installed;
    if (installedCount === 0) {
      errors.push('请至少安装一个技能');
    }

    if (errors.length > 0) {
      alert('请完善以下内容:\n' + errors.join('\n'));
      return;
    }

    const config: AgentFullConfig = {
      soul: this.soul,
      rules: this.rules,
      skillTree: this.skillTree.getState(),
      attributes: this.attributes,
    };

    this.config.onComplete?.(config);
  }

  getConfig(): AgentFullConfig {
    // Get evolution prompt for rendering (agency templates use default)
    const evolutionPrompt = this.selectedTemplateId
      ? (SOUL_TEMPLATES.find(t => t.id === this.selectedTemplateId)?.evolutionPrompt
        || EVOLUTION_PROMPT)
      : EVOLUTION_PROMPT;

    // Generate rendered prompt
    const renderedPrompt = renderTemplatePrompt(this.soul, evolutionPrompt);

    return {
      soul: this.soul,
      rules: this.rules,
      skillTree: this.skillTree?.getState(),
      attributes: this.attributes,
      renderedPrompt,
      rawContent: this.selectedRawContent || undefined,
    };
  }

  destroy(): void {
    this.container?.destroy();
  }
}

export default AgentConfigPanel;
