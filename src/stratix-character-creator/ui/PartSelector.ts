/**
 * (Migrated)
 * PartSelector - 部位选择组件
 * Cyberpunk-style part selector with category tabs and variant dropdown
 */

import Phaser from 'phaser';
import { getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';
import { DOMContainer } from '@/stratix-core/ui/DOMContainer';
import { partRegistry } from '../core/PartRegistry';
import { PART_CATEGORY_CONFIGS } from '../config/partConfig';
import type { PartMetadata, BodyType, PartCategory, PartSelection } from '../types';

// 使用 CSS 变量以支持主题动态切换
const THEME = {
  bg: 'var(--ds-bg-secondary)',
  panelBg: 'var(--ds-bg-secondary)',
  panelBorder: 'var(--ds-border)',
  accent: 'var(--ds-brand-primary)',
  accentDim: 'var(--ds-brand-secondary)',
  text: 'var(--ds-text-primary)',
  textMuted: 'var(--ds-text-muted)',
  hoverBg: 'var(--ds-bg-tertiary)',
  selectedBg: 'var(--ds-brand-secondary)',
  danger: 'var(--ds-status-danger)',
  success: 'var(--ds-status-success)'
};

const CATEGORY_ICONS: Record<string, string> = {
  shadow: '[S]', body: '[B]', head: '[H]', eyes: '[E]', hair: '[H]',
  ears: '[E]', nose: '[N]', facial: '[F]', torso: '[T]', arms: '[A]',
  hands: '[H]', legs: '[L]', feet: '[F]', cape: '[C]', backpack: '[B]',
  neck: '[N]', shoulders: '[S]', wrists: '[W]', shield: '[S]', weapon: '[W]',
  hat: '[H]', quiver: '[Q]'
};

export interface PartSelectorConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  bodyType: BodyType;
  onPartSelected: (category: PartCategory, itemId: string, variant: string) => void;
  onRandomize?: () => void;
  onNext?: () => void;
}

export class PartSelector {
  private scene: Phaser.Scene;
  private config: PartSelectorConfig;
  private container: DOMContainer | null = null;
  private currentSelections: Record<string, PartSelection> = {};
  private currentCategory: PartCategory | null = null;

  constructor(scene: Phaser.Scene, config: PartSelectorConfig) {
    this.scene = scene;
    this.config = config;
  }

  create(): Phaser.GameObjects.DOMElement {
    const html = this.generateHTML();

    this.container = new DOMContainer(this.scene, {
      x: this.config.x,
      y: this.config.y,
      width: this.config.width,
      height: this.config.height,
      html: html,
      depth: Depth.UI_MODAL_CONTENT
    });

    const element = this.container.open();
    this.setupEventListeners();

    return element;
  }

  private generateHTML(): string {
    const categories = Object.keys(PART_CATEGORY_CONFIGS) as PartCategory[];
    
    const categoryTabs = categories.map(cat => {
      const icon = CATEGORY_ICONS[cat] || '[?]';
      const label = PART_CATEGORY_CONFIGS[cat]?.label || cat;
      return `<button class="cat-btn" data-category="${cat}" title="${label}">${icon}</button>`;
    }).join('');

    return `
      <div class="part-selector" style="
        width: ${this.config.width}px;
        height: ${this.config.height}px;
        background: ${THEME.panelBg};
        border: 1px solid ${THEME.panelBorder};
        border-radius: 8px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
      ">
        <div class="header" style="
          padding: 12px 16px;
          border-bottom: 1px solid ${THEME.panelBorder};
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <div style="font-size: 14px; color: ${THEME.accent};">外观配置 Appearance</div>
        </div>
        <div class="categories" style="
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          padding: 12px 16px;
          background: ${THEME.bg};
          border-bottom: 1px solid ${THEME.panelBorder};
        ">
          ${categoryTabs}
        </div>
        <div class="parts-list" style="
          flex: 1;
          padding: 8px;
          overflow-y: auto;
          background: ${THEME.bg};
        ">
          <p style="color: ${THEME.textMuted}; text-align: center; padding: 40px 20px; font-size: 12px;">
            选择类别查看可用部件<br>Select a category
          </p>
        </div>
        <div class="footer" style="
          padding: 16px;
          border-top: 1px solid ${THEME.panelBorder};
          display: flex;
          justify-content: space-between;
          gap: 12px;
        ">
          <button id="random-btn" style="
            padding: 10px 20px;
            background: ${THEME.accentDim};
            border: 1px solid ${THEME.success};
            border-radius: 4px;
            color: ${THEME.success};
            font-family: inherit;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
          ">随机 RANDOM</button>
          <button id="next-btn" style="
            padding: 10px 24px;
            background: ${THEME.success};
            border: none;
            border-radius: 4px;
            color: ${THEME.bg};
            font-family: inherit;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
          ">下一步 NEXT →</button>
        </div>
      </div>
      <style>
        .cat-btn {
          width: 32px;
          height: 32px;
          background: transparent;
          border: 1px solid ${THEME.panelBorder};
          border-radius: 4px;
          color: ${THEME.textMuted};
          font-size: 10px;
          font-family: monospace;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .cat-btn:hover {
          background: ${THEME.hoverBg};
          border-color: ${THEME.accent};
          color: ${THEME.text};
        }
        .cat-btn.active {
          background: ${THEME.accentDim};
          border-color: ${THEME.accent};
          color: ${THEME.accent};
        }
        .part-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          margin-bottom: 6px;
          background: ${THEME.panelBg};
          border: 1px solid ${THEME.panelBorder};
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .part-item:hover {
          border-color: ${THEME.accent};
          background: ${THEME.hoverBg};
        }
        .part-item.selected {
          background: ${THEME.selectedBg};
          border-color: ${THEME.accent};
        }
        .part-name {
          flex: 1;
          font-size: 12px;
          color: ${THEME.text};
        }
        .part-meta {
          font-size: 10px;
          color: ${THEME.textMuted};
          margin-left: 8px;
        }
        .variant-select {
          padding: 4px 8px;
          background: ${THEME.bg};
          border: 1px solid ${THEME.panelBorder};
          border-radius: 4px;
          color: ${THEME.text};
          font-size: 10px;
          font-family: monospace;
          cursor: pointer;
          min-width: 70px;
        }
        .variant-select:focus {
          outline: none;
          border-color: ${THEME.accent};
        }
        .parts-list::-webkit-scrollbar {
          width: 6px;
        }
        .parts-list::-webkit-scrollbar-track {
          background: ${THEME.bg};
        }
        .parts-list::-webkit-scrollbar-thumb {
          background: ${THEME.panelBorder};
          border-radius: 3px;
        }
        .parts-list::-webkit-scrollbar-thumb:hover {
          background: ${THEME.accent};
        }
        .empty-state {
          text-align: center;
          padding: 40px 20px;
          color: ${THEME.textMuted};
          font-size: 12px;
        }
        #random-btn:hover {
          opacity: 0.9;
        }
        #next-btn:hover {
          opacity: 0.9;
        }
      </style>
    `;
  }

  private setupEventListeners(): void {
    const node = this.container?.getNode();
    if (!node) return;

    node.querySelectorAll('.cat-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const category = (e.target as HTMLElement).dataset.category as PartCategory;
        this.showCategory(category);

        node.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        (e.target as HTMLElement).classList.add('active');
      });
    });

    const randomBtn = node.querySelector('#random-btn');
    randomBtn?.addEventListener('click', () => {
      this.config.onRandomize?.();
    });

    const nextBtn = node.querySelector('#next-btn');
    nextBtn?.addEventListener('click', () => {
      this.config.onNext?.();
    });
  }

  private showCategory(category: PartCategory): void {
    const node = this.container?.getNode();
    if (!node) return;

    this.currentCategory = category;

    const parts = partRegistry.getPartsByCategory(category)
      .filter(p => p.required.includes(this.config.bodyType));

    const listNode = node.querySelector('.parts-list');
    if (!listNode) return;

    if (parts.length === 0) {
      listNode.innerHTML = `<p class="empty-state">此类别暂无部件<br>No parts available</p>`;
      return;
    }

    listNode.innerHTML = parts.map(part => {
      const currentSelection = this.currentSelections[category];
      const isSelected = currentSelection?.itemId === part.itemId;
      const variants = part.variants?.length ? part.variants : ['default'];
      const animCount = part.animations?.length || 0;

      const variantOptions = variants.map(v =>
        `<option value="${v}" ${currentSelection?.variant === v ? 'selected' : ''}>${v}</option>`
      ).join('');

      return `
        <div class="part-item ${isSelected ? 'selected' : ''}" data-item-id="${part.itemId}">
          <span class="part-name">${part.name}</span>
          <span class="part-meta">${animCount} anim</span>
          ${variants.length > 1 ? `
            <select class="variant-select" data-item-id="${part.itemId}">
              ${variantOptions}
            </select>
          ` : ''}
        </div>
      `;
    }).join('');

    // 添加点击事件
    listNode.querySelectorAll('.part-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('variant-select')) return;

        const itemId = (item as HTMLElement).dataset.itemId!;
        const variantSelect = item.querySelector('.variant-select') as HTMLSelectElement;
        const variant = variantSelect?.value || 'default';

        this.selectPart(category, itemId, variant);

        listNode.querySelectorAll('.part-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
      });
    });

    // 变体选择事件
    listNode.querySelectorAll('.variant-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const itemId = (e.target as HTMLElement).dataset.itemId!;
        const variant = (e.target as HTMLSelectElement).value;
        this.selectPart(category, itemId, variant);
      });
    });
  }

  private selectPart(category: PartCategory, itemId: string, variant: string): void {
    this.currentSelections[category] = { itemId, variant };
    this.config.onPartSelected(category, itemId, variant);
  }

  setCurrentSelections(selections: Record<string, PartSelection>): void {
    this.currentSelections = { ...selections };
    
    if (this.currentCategory) {
      this.showCategory(this.currentCategory);
    }
  }

  setBodyType(bodyType: BodyType): void {
    this.config.bodyType = bodyType;
    if (this.currentCategory) {
      this.showCategory(this.currentCategory);
    }
  }

  destroy(): void {
    this.container?.destroy();
    this.container = null;
  }
}
