import Phaser from 'phaser';
import { getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';
import { ContainerComponentBase } from '@/stratix-core/ui/ContainerComponent.base';
import type { StratixSoulConfig } from '@/stratix-core/stratix-protocol';
import { SOUL_TEMPLATES, DEFAULT_SOUL, type SoulTemplate } from '../config/soulTemplates';
import { getButtonInlineStyles } from './_buttonStyles';
import { renderTemplatePrompt } from '../core/SoulTemplateRenderer';

export interface SoulEditorConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  initialSoul?: StratixSoulConfig;
  onChange?: (soul: StratixSoulConfig) => void;
}

// 目标项（含优先级）
export interface GoalItem {
  text: string;
  priority?: 'high' | 'medium' | 'low';
}

const THEME = {
  bg: 'var(--ds-bg-secondary)',
  border: 'var(--ds-border)',
  accent: 'var(--ds-brand-primary)',
  text: 'var(--ds-text-primary)',
  textMuted: 'var(--ds-text-muted)',
  inputBg: 'var(--ds-bg-tertiary)',
  success: 'var(--ds-status-success)',
  priorityHigh: '#ef4444',
  priorityMedium: '#f59e0b',
  priorityLow: '#22c55e',
};

const MAX_HISTORY_SIZE = 50;

// 目标自动补全建议库（按领域分类）
interface GoalSuggestion {
  text: string;
  domains: string[]; // 适用的领域
}

const GOAL_SUGGESTIONS: GoalSuggestion[] = [
  // 通用目标
  { text: '理解用户需求，提供精准服务', domains: ['general', 'product', 'design'] },
  { text: '持续学习，提升专业知识储备', domains: ['general', 'engineering', 'academic'] },
  { text: '及时响应，保持高效沟通', domains: ['general', 'support', 'sales'] },
  { text: '主动思考，提出建设性建议', domains: ['general', 'product', 'project-management'] },
  { text: '总结经验，优化工作流程', domains: ['general', 'engineering', 'project-management'] },
  // 开发相关
  { text: '编写高质量、可维护的代码', domains: ['engineering', 'game-development', 'testing'] },
  { text: '进行代码审查，确保代码质量', domains: ['engineering', 'testing'] },
  { text: '优化性能，提升系统效率', domains: ['engineering', 'game-development'] },
  { text: '编写技术文档，记录关键信息', domains: ['engineering', 'academic', 'technical-writing'] },
  { text: '调试并修复问题，确保功能稳定', domains: ['engineering', 'testing', 'support'] },
  { text: '遵循开发规范，保证代码一致性', domains: ['engineering', 'game-development'] },
  { text: '重构遗留代码，提升可读性', domains: ['engineering'] },
  // 设计相关
  { text: '设计用户友好的界面和体验', domains: ['design', 'product'] },
  { text: '保持设计一致性和品牌调性', domains: ['design', 'marketing'] },
  { text: '进行用户测试，收集反馈迭代', domains: ['design', 'product', 'testing'] },
  { text: '创建可复用的设计组件库', domains: ['design', 'engineering'] },
  // 市场营销相关
  { text: '分析市场趋势，制定营销策略', domains: ['marketing', 'product', 'sales'] },
  { text: '创作吸引人的营销内容', domains: ['marketing', 'paid-media'] },
  { text: '监测营销效果，优化投放', domains: ['marketing', 'paid-media'] },
  { text: '建立品牌认知，提升影响力', domains: ['marketing', 'sales'] },
  // 销售相关
  { text: '理解客户需求，提供解决方案', domains: ['sales', 'support'] },
  { text: '维护客户关系，提升满意度', domains: ['sales', 'support'] },
  { text: '分析销售数据，挖掘增长机会', domains: ['sales', 'marketing'] },
  // 产品相关
  { text: '分析用户反馈，持续优化产品', domains: ['product', 'design', 'engineering'] },
  { text: '制定产品路线图，规划迭代', domains: ['product', 'project-management'] },
  { text: '进行竞品分析，保持竞争优势', domains: ['product', 'marketing'] },
  { text: '定义产品需求，撰写 PRD', domains: ['product', 'design'] },
  // 项目管理相关
  { text: '制定项目计划，控制进度', domains: ['project-management'] },
  { text: '协调资源，确保项目按时交付', domains: ['project-management'] },
  { text: '识别项目风险，制定应对策略', domains: ['project-management'] },
  // 数据分析相关
  { text: '收集并整理相关数据', domains: ['analytics', 'marketing', 'product'] },
  { text: '分析数据趋势，提取关键洞察', domains: ['analytics', 'product', 'marketing'] },
  { text: '制作可视化图表，帮助理解', domains: ['analytics', 'product', 'marketing'] },
  { text: '撰写分析报告，提出建议', domains: ['analytics', 'product', 'marketing'] },
  // 测试相关
  { text: '编写测试用例，覆盖关键场景', domains: ['testing', 'engineering'] },
  { text: '执行测试，发现并报告问题', domains: ['testing', 'engineering'] },
  { text: '验证修复，确保问题不再现', domains: ['testing', 'engineering'] },
  // 客户支持相关
  { text: '快速响应客户问题，解决疑虑', domains: ['support', 'sales'] },
  { text: '记录问题反馈，推动产品改进', domains: ['support', 'product'] },
  { text: '提供技术支持，提升用户体验', domains: ['support', 'engineering'] },
];

export class SoulEditor {
  private scene: Phaser.Scene;
  private config: SoulEditorConfig;
  private container: Phaser.GameObjects.DOMElement | null = null;
  private soul: StratixSoulConfig;
  private rawContent: string = '';
  private onChange?: (soul: StratixSoulConfig) => void;

  // 目标完成状态
  private completedGoals = new Set<number>();

  // 目标完成状态持久化
  private static readonly COMPLETED_GOALS_KEY = 'soul-editor-completed-goals';

  private loadCompletedGoals(): void {
    try {
      const stored = localStorage.getItem(SoulEditor.COMPLETED_GOALS_KEY);
      if (stored) {
        const indices = JSON.parse(stored) as number[];
        this.completedGoals = new Set(indices);
      }
    } catch {
      this.completedGoals = new Set();
    }
  }

  private saveCompletedGoals(): void {
    const indices = Array.from(this.completedGoals);
    localStorage.setItem(SoulEditor.COMPLETED_GOALS_KEY, JSON.stringify(indices));
  }

  // Undo/Redo history
  private undoStack: StratixSoulConfig[] = [];
  private redoStack: StratixSoulConfig[] = [];

  constructor(scene: Phaser.Scene, config: SoulEditorConfig) {
    this.scene = scene;
    this.config = config;
    this.soul = config.initialSoul ? { ...config.initialSoul } : { ...DEFAULT_SOUL };
    this.onChange = config.onChange;
    this.loadCompletedGoals();
    this.saveHistory();
  }

  private saveHistory(): void {
    this.undoStack.push({
      identity: this.soul.identity,
      goals: [...this.soul.goals],
      personality: this.soul.personality,
    });
    if (this.undoStack.length > MAX_HISTORY_SIZE) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 1;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    if (!this.canUndo()) return;
    const current = this.undoStack.pop()!;
    this.redoStack.push(current);
    const previous = this.undoStack[this.undoStack.length - 1];
    this.soul = {
      identity: previous.identity,
      goals: [...previous.goals],
      personality: previous.personality,
    };
    this.updateUI();
    this.notifyChange();
  }

  redo(): void {
    if (!this.canRedo()) return;
    const next = this.redoStack.pop()!;
    this.undoStack.push(next);
    this.soul = {
      identity: next.identity,
      goals: [...next.goals],
      personality: next.personality,
    };
    this.updateUI();
    this.notifyChange();
  }

  // 最近使用的模板
  private static readonly RECENT_TEMPLATES_KEY = 'soul-editor-recent-templates';
  private static readonly MAX_RECENT = 5;

  private getRecentTemplates(): string[] {
    try {
      const stored = localStorage.getItem(SoulEditor.RECENT_TEMPLATES_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  private addToRecentTemplates(templateId: string): void {
    const recent = this.getRecentTemplates().filter(id => id !== templateId);
    recent.unshift(templateId);
    if (recent.length > SoulEditor.MAX_RECENT) {
      recent.pop();
    }
    localStorage.setItem(SoulEditor.RECENT_TEMPLATES_KEY, JSON.stringify(recent));
  }

  // 模板使用统计
  private static readonly TEMPLATE_STATS_KEY = 'soul-editor-template-stats';

  private getTemplateStats(): Record<string, number> {
    try {
      const stored = localStorage.getItem(SoulEditor.TEMPLATE_STATS_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  private incrementTemplateStats(templateId: string): void {
    const stats = this.getTemplateStats();
    stats[templateId] = (stats[templateId] || 0) + 1;
    localStorage.setItem(SoulEditor.TEMPLATE_STATS_KEY, JSON.stringify(stats));
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
        <div class="goal-item" data-index="${i}" draggable="true" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; cursor: grab; padding: 4px; border-radius: 4px; transition: background 0.15s;">
          <span class="priority-indicator" data-priority="medium" style="width: 4px; height: 16px; border-radius: 2px; background: ${THEME.priorityMedium}; flex-shrink: 0;"></span>
          <span class="drag-handle" style="color: ${THEME.textMuted}; cursor: grab; font-size: 14px; padding: 0 4px;">⋮⋮</span>
          <span style="flex: 1; color: ${THEME.text}; font-size: 12px;">${this.escapeHtml(goal)}</span>
          <select class="priority-select" data-index="${i}" style="background: ${THEME.inputBg}; border: 1px solid ${THEME.border}; border-radius: 4px; color: ${THEME.text}; font-size: 10px; padding: 2px 4px; cursor: pointer;">
            <option value="high" style="color: ${THEME.priorityHigh};">高</option>
            <option value="medium" selected style="color: ${THEME.priorityMedium};">中</option>
            <option value="low" style="color: ${THEME.priorityLow};">低</option>
          </select>
          <button class="remove-goal-btn" data-index="${i}" style="${getButtonInlineStyles('danger')}">删除</button>
        </div>
      `
      )
      .join('');

    return `
      <style>
        .goal-item:hover { background: var(--ds-bg-tertiary); }
        .goal-item.drag-before {
          border-top: 3px solid var(--ds-brand-primary);
          margin-top: -1px;
          padding-top: 3px;
        }
        .goal-item.drag-after {
          border-bottom: 3px solid var(--ds-brand-primary);
          margin-bottom: -1px;
          padding-bottom: 3px;
        }
        .priority-select:hover { border-color: var(--ds-brand-primary); }
      </style>
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
          <input type="text" id="template-search" placeholder="搜索模板..." style="
            width: 100%;
            padding: 8px 12px;
            background: ${THEME.inputBg};
            border: 1px solid ${THEME.border};
            border-radius: 6px;
            color: ${THEME.text};
            font-size: 12px;
            margin-bottom: 8px;
            box-sizing: border-box;
          " />
          <div id="domain-filters" style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;">
            <button class="domain-filter-btn active" data-domain="all" style="padding: 4px 10px; font-size: 11px; border-radius: 12px; border: 1px solid ${THEME.border}; background: ${THEME.accent}; color: white; cursor: pointer;">全部</button>
            <button class="domain-filter-btn" data-domain="general" style="padding: 4px 10px; font-size: 11px; border-radius: 12px; border: 1px solid ${THEME.border}; background: ${THEME.inputBg}; color: ${THEME.text}; cursor: pointer;">通用</button>
            <button class="domain-filter-btn" data-domain="engineering" style="padding: 4px 10px; font-size: 11px; border-radius: 12px; border: 1px solid ${THEME.border}; background: ${THEME.inputBg}; color: ${THEME.text}; cursor: pointer;">开发</button>
            <button class="domain-filter-btn" data-domain="design" style="padding: 4px 10px; font-size: 11px; border-radius: 12px; border: 1px solid ${THEME.border}; background: ${THEME.inputBg}; color: ${THEME.text}; cursor: pointer;">设计</button>
            <button class="domain-filter-btn" data-domain="marketing" style="padding: 4px 10px; font-size: 11px; border-radius: 12px; border: 1px solid ${THEME.border}; background: ${THEME.inputBg}; color: ${THEME.text}; cursor: pointer;">营销</button>
            <button class="domain-filter-btn" data-domain="product" style="padding: 4px 10px; font-size: 11px; border-radius: 12px; border: 1px solid ${THEME.border}; background: ${THEME.inputBg}; color: ${THEME.text}; cursor: pointer;">产品</button>
          </div>
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

        <div class="section" style="margin-bottom: 16px; display: flex; gap: 8px;">
          <button id="import-soul-btn" style="${getButtonInlineStyles('secondary')}">导入</button>
          <button id="export-soul-btn" style="${getButtonInlineStyles('secondary')}">导出</button>
          <button id="copy-soul-btn" style="${getButtonInlineStyles('ghost')}">复制配置</button>
          <button id="undo-btn" disabled style="${getButtonInlineStyles('ghost')}">↩ 撤销</button>
          <button id="redo-btn" disabled style="${getButtonInlineStyles('ghost')}">↪ 重做</button>
          <input type="file" id="import-file-input" accept=".json" style="display: none;" />
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
          <div style="text-align: right; margin-top: 4px;">
            <span id="identity-char-count" style="font-size: 10px; color: ${THEME.textMuted};">${this.soul.identity.length} 字符</span>
          </div>
        </div>

        <div class="section" style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <label style="display: block; font-size: 11px; color: ${THEME.textMuted};">
              目标 GOALS
            </label>
            <span id="goals-progress" style="font-size: 10px; color: ${THEME.textMuted};">0/0 完成</span>
          </div>
          <div id="goals-list" style="margin-bottom: 8px;">
            ${goalsHtml || '<span style="color: ' + THEME.textMuted + '; font-size: 12px;">暂无目标</span>'}
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <input type="text" id="new-goal-input" placeholder="输入新目标..." style="
              flex: 1;
              min-width: 150px;
              padding: 8px 12px;
              background: ${THEME.inputBg};
              border: 1px solid ${THEME.border};
              border-radius: 6px;
              color: ${THEME.text};
              font-size: 12px;
            " />
            <button id="add-goal-btn" style="${getButtonInlineStyles('primary')}">添加</button>
          </div>
          <div id="goal-suggestions" style="display: none; margin-top: 8px; background: ${THEME.inputBg}; border: 1px solid ${THEME.border}; border-radius: 6px; max-height: 120px; overflow-y: auto;"></div>
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

        <div class="section" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid ${THEME.border};">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label style="font-size: 11px; color: ${THEME.textMuted}; cursor: pointer;" id="prompt-preview-toggle">
              ▼ Prompt 实时预览
            </label>
            <button id="copy-prompt-btn" style="${getButtonInlineStyles('ghost')}">复制</button>
          </div>
          <pre id="prompt-preview" style="
            background: ${THEME.inputBg};
            border: 1px solid ${THEME.border};
            border-radius: 6px;
            padding: 12px;
            font-size: 10px;
            line-height: 1.6;
            width: 100%;
            min-height: 100px;
            max-height: 200px;
            overflow-y: auto;
            white-space: pre-wrap;
            word-break: break-all;
            color: ${THEME.text};
            font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
            box-sizing: border-box;
            margin: 0;
          ">${this.escapeHtml(this.buildPromptPreview())}</pre>
        </div>

        <div class="section" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid ${THEME.border};">
          <div style="display: flex; gap: 16px; flex-wrap: wrap;">
            <span style="font-size: 10px; color: ${THEME.textMuted};">
              <kbd style="background: ${THEME.inputBg}; padding: 2px 6px; border-radius: 3px; border: 1px solid ${THEME.border};">Ctrl+Z</kbd> 撤销
            </span>
            <span style="font-size: 10px; color: ${THEME.textMuted};">
              <kbd style="background: ${THEME.inputBg}; padding: 2px 6px; border-radius: 3px; border: 1px solid ${THEME.border};">Ctrl+Shift+Z</kbd> 重做
            </span>
            <span style="font-size: 10px; color: ${THEME.textMuted};">
              <kbd style="background: ${THEME.inputBg}; padding: 2px 6px; border-radius: 3px; border: 1px solid ${THEME.border};">Enter</kbd> 添加目标
            </span>
            <span style="font-size: 10px; color: ${THEME.textMuted};">
              <kbd style="background: ${THEME.inputBg}; padding: 2px 6px; border-radius: 3px; border: 1px solid ${THEME.border};">⋮⋮</kbd> 拖拽排序
            </span>
          </div>
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
    const copyPromptBtn = node.querySelector('#copy-prompt-btn') as HTMLButtonElement;
    const importSoulBtn = node.querySelector('#import-soul-btn') as HTMLButtonElement;
    const exportSoulBtn = node.querySelector('#export-soul-btn') as HTMLButtonElement;
    const copySoulBtn = node.querySelector('#copy-soul-btn') as HTMLButtonElement;
    const undoBtn = node.querySelector('#undo-btn') as HTMLButtonElement;
    const redoBtn = node.querySelector('#redo-btn') as HTMLButtonElement;
    const importFileInput = node.querySelector('#import-file-input') as HTMLInputElement;
    const templateSearch = node.querySelector('#template-search') as HTMLInputElement;
    const domainFilters = node.querySelector('#domain-filters') as HTMLElement;
    let currentDomain = 'all';

    // Prompt 预览折叠/展开
    const promptPreviewToggle = node.querySelector('#prompt-preview-toggle') as HTMLElement;
    const promptPreview = node.querySelector('#prompt-preview') as HTMLPreElement;
    let isPreviewCollapsed = false;

    promptPreviewToggle?.addEventListener('click', () => {
      isPreviewCollapsed = !isPreviewCollapsed;
      if (promptPreview) {
        promptPreview.style.display = isPreviewCollapsed ? 'none' : 'block';
      }
      if (promptPreviewToggle) {
        promptPreviewToggle.textContent = isPreviewCollapsed ? '▶ Prompt 实时预览' : '▼ Prompt 实时预览';
      }
    });

    // 领域筛选事件
    domainFilters?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('domain-filter-btn')) {
        // 更新选中状态
        domainFilters.querySelectorAll('.domain-filter-btn').forEach(btn => {
          (btn as HTMLElement).style.background = THEME.inputBg;
          (btn as HTMLElement).style.color = THEME.text;
        });
        target.style.background = THEME.accent;
        target.style.color = 'white';

        currentDomain = target.dataset.domain || 'all';
        templateSearch.value = '';
        filterTemplates('');
      }
    });

    // 模板搜索过滤
    const filterTemplates = (query: string) => {
      const q = query.toLowerCase().trim();
      const recent = this.getRecentTemplates();
      const stats = this.getTemplateStats();
      templateSelect.innerHTML = '<option value="">-- 选择模板 --</option>';

      // 获取使用次数显示
      const getUsageText = (templateId: string): string => {
        const count = stats[templateId];
        return count ? ` (使用${count}次)` : '';
      };

      // 如果没有搜索词，显示最近使用的模板
      if (!q && recent.length > 0 && currentDomain === 'all') {
        const recentGroup = document.createElement('optgroup');
        recentGroup.label = '最近使用';
        recent.forEach(templateId => {
          const t = SOUL_TEMPLATES.find(st => st.id === templateId);
          if (t) {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.name + getUsageText(t.id);
            recentGroup.appendChild(option);
          }
        });
        templateSelect.appendChild(recentGroup);

        const divider = document.createElement('optgroup');
        divider.label = '──────────';
        templateSelect.appendChild(divider);
      }

      SOUL_TEMPLATES.forEach(t => {
        // 检查领域筛选
        const matchesDomain = currentDomain === 'all' || t.domain === currentDomain;

        // 搜索模式下显示所有匹配项，否则显示非最近的
        if (q) {
          if (matchesDomain && (t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))) {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = `${t.name}${getUsageText(t.id)} - ${t.description}`;
            templateSelect.appendChild(option);
          }
        } else if (matchesDomain && !recent.includes(t.id)) {
          const option = document.createElement('option');
          option.value = t.id;
          option.textContent = t.name + getUsageText(t.id);
          templateSelect.appendChild(option);
        }
      });
    };

    templateSearch?.addEventListener('input', (e) => {
      filterTemplates((e.target as HTMLInputElement).value);
    });

    templateSelect?.addEventListener('change', (e) => {
      const templateId = (e.target as HTMLSelectElement).value;
      if (templateId) {
        const template = SOUL_TEMPLATES.find((t) => t.id === templateId);
        if (template) {
          this.applyTemplate(template);
        }
      }
    });

    // 目标自动补全建议
    const goalSuggestions = node.querySelector('#goal-suggestions') as HTMLElement;
    let suggestionSelectedIndex = -1;
    let currentMatches: GoalSuggestion[] = [];

    const showGoalSuggestions = (query: string) => {
      if (!goalSuggestions) return;
      const q = query.toLowerCase().trim();

      if (!q) {
        goalSuggestions.style.display = 'none';
        suggestionSelectedIndex = -1;
        return;
      }

      // 根据当前选择的领域过滤建议
      currentMatches = GOAL_SUGGESTIONS.filter(g =>
        g.text.toLowerCase().includes(q) &&
        !this.soul.goals.includes(g.text) &&
        (currentDomain === 'all' || g.domains.includes(currentDomain))
      ).slice(0, 6);

      if (currentMatches.length === 0) {
        goalSuggestions.style.display = 'none';
        suggestionSelectedIndex = -1;
        return;
      }

      goalSuggestions.innerHTML = currentMatches.map((g, i) =>
        `<div class="goal-suggestion" data-index="${i}" data-goal="${this.escapeHtml(g.text)}" style="
          padding: 8px 12px;
          cursor: pointer;
          font-size: 12px;
          color: ${THEME.text};
          background: ${i === suggestionSelectedIndex ? THEME.accent + '22' : 'transparent'};
        ">${this.escapeHtml(g.text)}</div>`
      ).join('');

      goalSuggestions.style.display = 'block';

      goalSuggestions.querySelectorAll('.goal-suggestion').forEach(el => {
        el.addEventListener('click', () => {
          const goal = (el as HTMLElement).dataset.goal!;
          newGoalInput.value = goal;
          goalSuggestions.style.display = 'none';
          suggestionSelectedIndex = -1;
        });
        el.addEventListener('mouseenter', () => {
          suggestionSelectedIndex = parseInt((el as HTMLElement).dataset.index || '-1', 10);
          updateSuggestionHighlight();
        });
      });
    };

    const updateSuggestionHighlight = () => {
      if (!goalSuggestions) return;
      goalSuggestions.querySelectorAll('.goal-suggestion').forEach((el, i) => {
        (el as HTMLElement).style.background = i === suggestionSelectedIndex ? THEME.accent + '22' : 'transparent';
      });
    };

    const selectSuggestion = () => {
      if (suggestionSelectedIndex >= 0 && suggestionSelectedIndex < currentMatches.length) {
        newGoalInput.value = currentMatches[suggestionSelectedIndex].text;
        goalSuggestions.style.display = 'none';
        suggestionSelectedIndex = -1;
      }
    };

    newGoalInput?.addEventListener('input', (e) => {
      suggestionSelectedIndex = -1;
      showGoalSuggestions((e.target as HTMLInputElement).value);
    });

    newGoalInput?.addEventListener('keydown', (e) => {
      if (goalSuggestions.style.display !== 'block' || currentMatches.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        suggestionSelectedIndex = (suggestionSelectedIndex + 1) % currentMatches.length;
        updateSuggestionHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        suggestionSelectedIndex = suggestionSelectedIndex <= 0 ? currentMatches.length - 1 : suggestionSelectedIndex - 1;
        updateSuggestionHighlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        selectSuggestion();
      } else if (e.key === 'Escape') {
        goalSuggestions.style.display = 'none';
        suggestionSelectedIndex = -1;
      }
    });

    newGoalInput?.addEventListener('blur', () => {
      // 延迟隐藏以便点击建议
      setTimeout(() => {
        goalSuggestions && (goalSuggestions.style.display = 'none');
      }, 200);
    });

    // 导入按钮
    importSoulBtn?.addEventListener('click', () => {
      importFileInput?.click();
    });

    // 导入文件选择
    importFileInput?.addEventListener('change', (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);

          // 验证 Soul 配置格式
          const errors: string[] = [];
          if (json.identity !== undefined && typeof json.identity !== 'string') {
            errors.push('identity 必须是字符串');
          }
          if (json.goals !== undefined && !Array.isArray(json.goals)) {
            errors.push('goals 必须是数组');
          }
          if (json.goals && Array.isArray(json.goals)) {
            const nonStringGoals = json.goals.filter((g: unknown) => typeof g !== 'string');
            if (nonStringGoals.length > 0) {
              errors.push('goals 数组中的所有元素必须是字符串');
            }
          }
          if (json.personality !== undefined && typeof json.personality !== 'string') {
            errors.push('personality 必须是字符串');
          }

          // 检查是否包含 Soul 配置的必要字段
          const hasSoulConfig = json.identity !== undefined || json.goals !== undefined || json.personality !== undefined;
          if (!hasSoulConfig) {
            errors.push('缺少 Soul 配置字段（identity, goals, personality）');
          }

          if (errors.length > 0) {
            this.showToast('导入失败：' + errors[0]);
            return;
          }

          this.saveHistory();
          this.soul = {
            identity: json.identity || '',
            goals: Array.isArray(json.goals) ? json.goals : [],
            personality: json.personality || '',
          };
          this.updateUI();
          this.notifyChange();
          this.showToast('导入成功');
        } catch {
          this.showToast('导入失败：无效的 JSON 格式');
        }
        // 清空 input 以便重复选择同一文件
        (e.target as HTMLInputElement).value = '';
      };
      reader.readAsText(file);
    });

    // 导出按钮
    exportSoulBtn?.addEventListener('click', () => {
      const exportData = {
        version: '1.0',
        exportedAt: Date.now(),
        soul: {
          identity: this.soul.identity,
          goals: this.soul.goals,
          personality: this.soul.personality,
        },
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'soul-template.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    // 复制配置按钮
    copySoulBtn?.addEventListener('click', () => {
      const exportData = {
        version: '1.0',
        exportedAt: Date.now(),
        soul: {
          identity: this.soul.identity,
          goals: this.soul.goals,
          personality: this.soul.personality,
        },
      };
      navigator.clipboard.writeText(JSON.stringify(exportData, null, 2)).then(() => {
        copySoulBtn.textContent = '已复制!';
        setTimeout(() => {
          if (copySoulBtn) copySoulBtn.textContent = '复制配置';
        }, 1500);
      });
    });

    identityInput?.addEventListener('input', (e) => {
      this.saveHistory();
      this.soul.identity = (e.target as HTMLTextAreaElement).value;
      this.updatePromptPreview();
      this.notifyChange();
      // 更新字符计数
      const charCountEl = node.querySelector('#identity-char-count') as HTMLElement;
      if (charCountEl) {
        charCountEl.textContent = `${this.soul.identity.length} 字符`;
      }
    });

    personalityInput?.addEventListener('input', (e) => {
      this.saveHistory();
      this.soul.personality = (e.target as HTMLInputElement).value;
      this.updatePromptPreview();
      this.notifyChange();
    });

    addGoalBtn?.addEventListener('click', () => {
      const goal = newGoalInput?.value.trim();
      if (goal) {
        this.saveHistory();
        this.soul.goals.push(goal);
        newGoalInput.value = '';
        // 隐藏建议列表
        if (goalSuggestions) goalSuggestions.style.display = 'none';
        this.refreshGoalsList();
        this.updatePromptPreview();
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
        this.saveHistory();
        const index = parseInt(target.dataset.index || '0', 10);
        this.soul.goals.splice(index, 1);
        // 重新构建 completedGoals 索引
        const newCompleted = new Set<number>();
        this.completedGoals.forEach(i => {
          if (i < index) newCompleted.add(i);
          else if (i > index) newCompleted.add(i - 1);
        });
        this.completedGoals = newCompleted;
        this.saveCompletedGoals();
        this.refreshGoalsList();
        this.updatePromptPreview();
        this.notifyChange();
      }
    });

    // 优先级选择事件
    goalsList?.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      if (target.classList.contains('priority-select')) {
        const priority = target.value;
        const indicator = target.previousElementSibling?.previousElementSibling as HTMLElement;
        if (indicator?.classList.contains('priority-indicator')) {
          const colors: Record<string, string> = {
            high: THEME.priorityHigh,
            medium: THEME.priorityMedium,
            low: THEME.priorityLow,
          };
          indicator.style.background = colors[priority] || THEME.priorityMedium;
        }
      }

      // 复选框完成状态
      if (target.classList.contains('goal-checkbox')) {
        const index = parseInt(target.dataset.index || '0', 10);
        const checkbox = target as unknown as HTMLInputElement;
        const isChecked = checkbox.checked;
        const goalItem = target.parentElement as HTMLElement;
        if (!goalItem) return;

        if (isChecked) {
          this.completedGoals.add(index);
          goalItem.classList.add('completed');
          goalItem.style.opacity = '0.6';
          const textEl = goalItem.querySelector('span:nth-child(4)') as HTMLElement;
          if (textEl) textEl.style.textDecoration = 'line-through';
        } else {
          this.completedGoals.delete(index);
          goalItem.classList.remove('completed');
          goalItem.style.opacity = '1';
          const textEl = goalItem.querySelector('span:nth-child(4)') as HTMLElement;
          if (textEl) textEl.style.textDecoration = 'none';
        }

        // 持久化完成状态
        this.saveCompletedGoals();

        // 更新进度显示
        const progressEl = node.querySelector('#goals-progress') as HTMLElement;
        if (progressEl) {
          const completed = this.completedGoals.size;
          const total = this.soul.goals.length;
          progressEl.textContent = `${completed}/${total} 完成`;
          progressEl.style.color = completed === total && total > 0 ? THEME.success : THEME.textMuted;
        }
      }
    });

    // 拖拽排序事件
    let draggedIndex: number | null = null;

    goalsList?.addEventListener('dragstart', (e: DragEvent) => {
      const target = (e.target as HTMLElement).closest('.goal-item') as HTMLElement;
      if (!target) return;
      draggedIndex = parseInt(target.dataset.index || '0', 10);
      target.style.opacity = '0.5';
      e.dataTransfer!.effectAllowed = 'move';
    });

    goalsList?.addEventListener('dragend', (e: DragEvent) => {
      const target = (e.target as HTMLElement).closest('.goal-item') as HTMLElement;
      if (target) target.style.opacity = '1';
      draggedIndex = null;
      this.refreshGoalsList();
    });

    goalsList?.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      const target = (e.target as HTMLElement).closest('.goal-item') as HTMLElement;
      if (!target || draggedIndex === null) return;

      const rect = target.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const isAfter = e.clientY > midY;

      // 移除所有放置指示器
      goalsList!.querySelectorAll('.goal-item').forEach(el => {
        el.classList.remove('drag-after', 'drag-before');
      });

      // 添加放置指示器
      if (isAfter) {
        target.classList.add('drag-after');
      } else {
        target.classList.add('drag-before');
      }
    });

    goalsList?.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      const target = (e.target as HTMLElement).closest('.goal-item') as HTMLElement;
      if (!target || draggedIndex === null) return;

      const rect = target.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const isAfter = e.clientY > midY;
      let dropIndex = parseInt(target.dataset.index || '0', 10);

      if (isAfter && draggedIndex < dropIndex) {
        dropIndex--;
      } else if (!isAfter && draggedIndex > dropIndex) {
        dropIndex++;
      }

      if (draggedIndex !== dropIndex) {
        this.saveHistory();
        const [moved] = this.soul.goals.splice(draggedIndex, 1);
        this.soul.goals.splice(dropIndex, 0, moved);
        this.refreshGoalsList();
        this.updatePromptPreview();
        this.notifyChange();
      }

      draggedIndex = null;
    });

    copyPromptBtn?.addEventListener('click', () => {
      const prompt = this.buildPromptPreview();
      navigator.clipboard.writeText(prompt).then(() => {
        copyPromptBtn.textContent = '已复制!';
        setTimeout(() => {
          if (copyPromptBtn) copyPromptBtn.textContent = '复制';
        }, 1500);
      });
    });

    // 键盘快捷键: Ctrl+Z 撤销, Ctrl+Shift+Z 重做
    node.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          this.undo();
          this.updateUndoRedoButtons();
        } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
          e.preventDefault();
          this.redo();
          this.updateUndoRedoButtons();
        }
      }
    });

    // Undo/Redo 按钮点击
    undoBtn?.addEventListener('click', () => {
      this.undo();
      this.updateUndoRedoButtons();
    });

    redoBtn?.addEventListener('click', () => {
      this.redo();
      this.updateUndoRedoButtons();
    });

    // 初始化按钮状态
    this.updateUndoRedoButtons();
  }

  private updateUndoRedoButtons(): void {
    const node = this.container?.node as HTMLElement;
    if (!node) return;
    const undoBtn = node.querySelector('#undo-btn') as HTMLButtonElement;
    const redoBtn = node.querySelector('#redo-btn') as HTMLButtonElement;
    if (undoBtn) undoBtn.disabled = !this.canUndo();
    if (redoBtn) redoBtn.disabled = !this.canRedo();
  }

  private applyTemplate(template: SoulTemplate): void {
    const soul = template.soul || { identity: '', goals: [], personality: '' };
    this.soul = {
      identity: soul.identity || '',
      goals: soul.goals ? [...soul.goals] : [],
      personality: soul.personality || '',
    };
    this.rawContent = template.rawContent || '';
    this.addToRecentTemplates(template.id);
    this.incrementTemplateStats(template.id);

    const node = this.container?.node as HTMLElement;
    if (!node) return;

    const identityInput = node.querySelector('#soul-identity') as HTMLTextAreaElement;
    const personalityInput = node.querySelector('#soul-personality') as HTMLInputElement;

    if (identityInput) identityInput.value = this.soul.identity;
    if (personalityInput) personalityInput.value = this.soul.personality;

    this.refreshGoalsList();
    this.updatePromptPreview();
    this.notifyChange();
  }

  private refreshGoalsList(): void {
    const node = this.container?.node as HTMLElement;
    const goalsList = node?.querySelector('#goals-list') as HTMLElement;
    const progressEl = node?.querySelector('#goals-progress') as HTMLElement;
    if (!goalsList) return;

    if (this.soul.goals.length === 0) {
      goalsList.innerHTML = `<span style="color: ${THEME.textMuted}; font-size: 12px;">暂无目标</span>`;
      if (progressEl) progressEl.textContent = '0/0 完成';
      return;
    }

    // 更新进度
    if (progressEl) {
      const completed = this.completedGoals.size;
      const total = this.soul.goals.length;
      progressEl.textContent = `${completed}/${total} 完成`;
      progressEl.style.color = completed === total && total > 0 ? THEME.success : THEME.textMuted;
    }

    goalsList.innerHTML = this.soul.goals
      .map(
        (goal, i) => {
          const isCompleted = this.completedGoals.has(i);
          return `
        <div class="goal-item ${isCompleted ? 'completed' : ''}" data-index="${i}" draggable="true" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; cursor: grab; padding: 4px; border-radius: 4px; transition: background 0.15s; opacity: ${isCompleted ? 0.6 : 1};">
          <input type="checkbox" class="goal-checkbox" data-index="${i}" ${isCompleted ? 'checked' : ''} style="width: 16px; height: 16px; cursor: pointer; accent-color: ${THEME.success};" />
          <span class="priority-indicator" data-priority="medium" style="width: 4px; height: 16px; border-radius: 2px; background: ${THEME.priorityMedium}; flex-shrink: 0;"></span>
          <span class="drag-handle" style="color: ${THEME.textMuted}; cursor: grab; font-size: 14px; padding: 0 4px;">⋮⋮</span>
          <span style="flex: 1; color: ${THEME.text}; font-size: 12px; text-decoration: ${isCompleted ? 'line-through' : 'none'};">${this.escapeHtml(goal)}</span>
          <select class="priority-select" data-index="${i}" style="background: ${THEME.inputBg}; border: 1px solid ${THEME.border}; border-radius: 4px; color: ${THEME.text}; font-size: 10px; padding: 2px 4px; cursor: pointer;">
            <option value="high" style="color: ${THEME.priorityHigh};">高</option>
            <option value="medium" selected style="color: ${THEME.priorityMedium};">中</option>
            <option value="low" style="color: ${THEME.priorityLow};">低</option>
          </select>
          <button class="remove-goal-btn" data-index="${i}" style="${getButtonInlineStyles('danger')}">删除</button>
        </div>
      `;
        }
      )
      .join('');
  }

  private escapeHtml(text: string): string {
    const div = { innerHTML: '' } as HTMLElement;
    div.textContent = text;
    return div.innerHTML;
  }

  private buildPromptPreview(): string {
    return renderTemplatePrompt(this.soul);
  }

  private updatePromptPreview(): void {
    const node = this.container?.node as HTMLElement;
    const previewEl = node?.querySelector('#prompt-preview') as HTMLPreElement;
    if (previewEl) {
      previewEl.textContent = this.buildPromptPreview();
    }
  }

  private notifyChange(): void {
    this.onChange?.(this.getSoul());
  }

  private updateUI(): void {
    const node = this.container?.node as HTMLElement;
    if (!node) return;

    const identityInput = node.querySelector('#soul-identity') as HTMLTextAreaElement;
    const personalityInput = node.querySelector('#soul-personality') as HTMLInputElement;

    if (identityInput) identityInput.value = this.soul.identity;
    if (personalityInput) personalityInput.value = this.soul.personality;
    this.refreshGoalsList();
    this.updatePromptPreview();
  }

  private showToast(message: string): void {
    const node = this.container?.node as HTMLElement;
    if (!node) return;

    // 创建 toast 元素
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--ds-bg-tertiary, #333);
      color: var(--ds-text-primary, #fff);
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 12px;
      z-index: 10000;
      animation: fadeIn 0.2s ease;
    `;

    // 添加动画样式
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(-10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
    `;
    document.head.appendChild(style);
    document.body.appendChild(toast);

    // 2秒后移除
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s';
      setTimeout(() => {
        toast.remove();
        style.remove();
      }, 200);
    }, 2000);
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
    this.updatePromptPreview();
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
