import Phaser from 'phaser';
import { getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';
import { ContainerComponentBase } from '@/stratix-core/ui/ContainerComponent.base';
import type { StratixSoulConfig, SkillTreeState } from '@/stratix-core/stratix-protocol';
import type { SavedCharacter } from '../types';
import { SoulEditor } from './SoulEditor';
import { RulesEditor } from './RulesEditor';
import { SkillTreeUI } from './SkillTreeUI';
import { SkillTree } from '../core/SkillTree';
import { SKILL_TREE_CONFIG } from '../config/skillTreeConfig';

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
}

const THEME = {
  bg: getToken('colors.background.secondary'),
  border: getToken('colors.border.default'),
  accent: getToken('colors.primary'),
  text: getToken('colors.text.primary'),
  textMuted: getToken('colors.text.muted'),
  activeTab: getToken('colors.secondary'),
};

type TabKey = 'skills' | 'rules' | 'soul';

export class AgentConfigPanel {
  private scene: Phaser.Scene;
  private config: AgentConfigPanelConfig;
  private container: Phaser.GameObjects.DOMElement | null = null;
  private currentTab: TabKey = 'soul';

  private soulEditor: SoulEditor | null = null;
  private rulesEditor: RulesEditor | null = null;
  private skillTreeUI: SkillTreeUI | null = null;
  private skillTree: SkillTree | null = null;

  private soul: StratixSoulConfig;
  private rules: string[];
  private attributes: Record<string, number> = {};

  constructor(scene: Phaser.Scene, config: AgentConfigPanelConfig) {
    this.scene = scene;
    this.config = config;

    this.soul = config.character.soul || {
      identity: '',
      goals: [],
      personality: '',
    };
    this.rules = config.character.rules || [];

    this.skillTree = new SkillTree(SKILL_TREE_CONFIG);
    if (config.character.skillTree) {
      this.skillTree.setState(config.character.skillTree);
    }
    this.attributes = this.skillTree.calculateAttributes();
  }

  create(): Phaser.GameObjects.DOMElement {
    const html = this.generateHTML();
    this.container = this.scene.add.dom(this.config.x, this.config.y).createFromHTML(html).setOrigin(0, 0).setDepth(Depth.UI_MODAL_CONTENT);
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
      ">
        <div class="tabs" style="
          display: flex;
          border-bottom: 1px solid ${THEME.border};
          background: #0d0d14;
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
          "></div>
          <div id="tab-rules" class="tab-panel" style="
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            padding: 12px;
            display: none;
          "></div>
          <div id="tab-skills" class="tab-panel" style="
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            padding: 12px;
            display: none;
          "></div>
        </div>

        <div class="attributes-bar" style="
          padding: 8px 16px;
          background: #0d0d14;
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
          background: #0d0d14;
          border-top: 1px solid ${THEME.border};
          display: flex;
          justify-content: space-between;
          gap: 12px;
        ">
          <button id="back-btn" style="
            padding: 8px 20px;
            background: transparent;
            border: 1px solid ${THEME.border};
            border-radius: 6px;
            color: ${THEME.textMuted};
            font-size: 12px;
            cursor: pointer;
          ">← 返回</button>
          <button id="complete-btn" style="
            padding: 8px 24px;
            background: #1a3a3a;
            border: 1px solid ${THEME.accent};
            border-radius: 6px;
            color: ${THEME.accent};
            font-size: 12px;
            cursor: pointer;
            font-weight: bold;
          ">完成配置 ✓</button>
        </div>
      </div>
    `;
  }

  private setupEventListeners(): void {
    if (!this.container) return;

    const node = this.container.node as HTMLElement;

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
    }

    this.createTabContent(tab, activePanel);
  }

  private createTabContent(tab: TabKey, panel: HTMLElement | null): void {
    if (!panel) return;

    switch (tab) {
      case 'soul':
        this.createSoulEditor(panel);
        break;
      case 'rules':
        this.createRulesEditor(panel);
        break;
      case 'skills':
        this.createSkillTreeEditor(panel);
        break;
    }
  }

  private createSoulEditor(panel: HTMLElement): void {
    if (this.soulEditor) {
      this.soulEditor.destroy();
    }

    const rect = panel.getBoundingClientRect();
    const width = rect.width || this.config.width - 24;
    const height = rect.height || this.config.height - 150;

    this.soulEditor = new SoulEditor(this.scene, {
      x: 0,
      y: 0,
      width,
      height,
      initialSoul: this.soul,
      onChange: (soul) => {
        this.soul = soul;
      },
    });

    const dom = this.soulEditor.create();
    panel.appendChild(dom.node as HTMLElement);
  }

  private createRulesEditor(panel: HTMLElement): void {
    if (this.rulesEditor) {
      this.rulesEditor.destroy();
    }

    const rect = panel.getBoundingClientRect();
    const width = rect.width || this.config.width - 24;
    const height = rect.height || this.config.height - 150;

    this.rulesEditor = new RulesEditor(this.scene, {
      x: 0,
      y: 0,
      width,
      height,
      initialRules: this.rules,
      onChange: (rules) => {
        this.rules = rules;
      },
    });

    const dom = this.rulesEditor.create();
    panel.appendChild(dom.node as HTMLElement);
  }

  private createSkillTreeEditor(panel: HTMLElement): void {
    if (this.skillTreeUI) {
      this.skillTreeUI.destroy();
    }

    const rect = panel.getBoundingClientRect();
    const width = rect.width || this.config.width - 24;
    const height = rect.height || this.config.height - 150;

    if (!this.skillTree) {
      this.skillTree = new SkillTree(SKILL_TREE_CONFIG);
    }

    this.skillTreeUI = new SkillTreeUI(this.scene, {
      x: 0,
      y: 0,
      width,
      height,
      skillTree: this.skillTree,
      onAttributesChange: (attrs) => {
        this.attributes = attrs;
        this.updateAttributesDisplay();
      },
    });

    const dom = this.skillTreeUI.create();
    panel.appendChild(dom.node as HTMLElement);
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
        const label = this.getAttributeLabel(key);
        return `<span style="color: ${THEME.accent};">${label}: +${value}</span>`;
      })
      .join('');
  }

  private getAttributeLabel(key: string): string {
    const labels: Record<string, string> = {
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
    return labels[key] || key;
  }

  private handleComplete(): void {
    const soulValidation = this.soulEditor?.validate() ?? { valid: true, errors: [] };
    const rulesValidation = this.rulesEditor?.validate() ?? { valid: true, errors: [] };

    const errors = [...soulValidation.errors, ...rulesValidation.errors];

    if (errors.length > 0) {
      alert('请完善以下内容:\n' + errors.join('\n'));
      return;
    }

    const config: AgentFullConfig = {
      soul: this.soul,
      rules: this.rules,
      skillTree: this.skillTree?.getState(),
      attributes: this.attributes,
    };

    this.config.onComplete?.(config);
  }

  getConfig(): AgentFullConfig {
    return {
      soul: this.soul,
      rules: this.rules,
      skillTree: this.skillTree?.getState(),
      attributes: this.attributes,
    };
  }

  destroy(): void {
    this.soulEditor?.destroy();
    this.rulesEditor?.destroy();
    this.skillTreeUI?.destroy();
    this.container?.destroy();
  }
}

export default AgentConfigPanel;
