/**
 * (Migrated)
 * CharacterList - 角色列表组件
 * Cyberpunk-style character list with selection and delete actions
 */

import Phaser from 'phaser';
import { getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';
import { ContainerComponentBase } from '@/stratix-core/ui/ContainerComponent.base';
import { characterStorage } from '../core/CharacterStorage';
import type { SavedCharacter } from '../types';

const THEME = {
  bg: 'var(--ds-bg-secondary)',
  panelBg: 'var(--ds-bg-secondary)',
  panelBorder: 'var(--ds-border)',
  accent: 'var(--ds-brand-primary)',
  accentDim: 'var(--ds-brand-secondary)',
  text: 'var(--ds-text-primary)',
  textMuted: 'var(--ds-text-muted)',
  hoverBg: 'var(--ds-bg-tertiary)',
  success: 'var(--ds-status-success)',
  danger: 'var(--ds-status-danger)'
};

export interface CharacterListConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  onCharacterSelected: (character: SavedCharacter) => void;
  onCharacterDeleted: (characterId: string) => void;
}

export class CharacterList {
  private scene: Phaser.Scene;
  private config: CharacterListConfig;
  private container: Phaser.GameObjects.DOMElement | null = null;
  private characters: SavedCharacter[] = [];

  constructor(scene: Phaser.Scene, config: CharacterListConfig) {
    this.scene = scene;
    this.config = config;
  }

  create(): Phaser.GameObjects.DOMElement {
    const html = this.generateHTML();

    this.container = this.scene.add.dom(
      this.config.x,
      this.config.y
    ).createFromHTML(html).setOrigin(0, 0);

    // 阻止所有点击事件冒泡到 canvas
    const node = this.container.node as HTMLElement;
    node.addEventListener('click', (e) => e.stopPropagation());
    node.addEventListener('pointerdown', (e) => e.stopPropagation());
    node.addEventListener('pointerup', (e) => e.stopPropagation());
    node.addEventListener('pointermove', (e) => e.stopPropagation());

    this.loadCharacters();

    return this.container;
  }

  private generateHTML(): string {
    return `
      <div class="char-list" style="
        width: ${this.config.width}px;
        height: ${this.config.height}px;
        background: ${THEME.panelBg};
        border: 1px solid ${THEME.panelBorder};
        border-radius: 4px;
        overflow: hidden;
        font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
        color: ${THEME.text};
        display: flex;
        flex-direction: column;
        pointer-events: auto;
      ">
        <div class="header" style="
          padding: 12px 16px;
          border-bottom: 1px solid ${THEME.panelBorder};
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <span style="font-size: 11px; color: ${THEME.textMuted}; letter-spacing: 1px;">已保存角色 SAVED</span>
          <button class="refresh-btn" style="
            padding: 4px 10px;
            background: transparent;
            border: 1px solid ${THEME.panelBorder};
            border-radius: 4px;
            color: ${THEME.textMuted};
            font-size: 10px;
            font-family: monospace;
            cursor: pointer;
            transition: all 0.15s ease;
          ">刷新</button>
        </div>
        <div class="list-content" style="
          flex: 1;
          overflow-y: auto;
          padding: 8px;
          background: ${THEME.bg};
        ">
          <p class="empty-state" style="
            text-align: center;
            padding: 40px 20px;
            color: ${THEME.textMuted};
            font-size: 12px;
          ">加载中 Loading...</p>
        </div>
      </div>
      <style>
        .refresh-btn:hover {
          border-color: ${THEME.accent};
          color: ${THEME.accent};
        }
        .char-item {
          display: flex;
          align-items: center;
          padding: 12px;
          margin-bottom: 4px;
          background: ${THEME.panelBg};
          border: 1px solid transparent;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .char-item:hover {
          background: ${THEME.hoverBg};
          border-color: ${THEME.panelBorder};
        }
        .char-item.default {
          border-left: 2px solid ${THEME.success};
        }
        .char-thumb {
          width: 40px;
          height: 40px;
          background: ${THEME.bg};
          border: 1px solid ${THEME.panelBorder};
          border-radius: 4px;
          margin-right: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          color: ${THEME.textMuted};
          overflow: hidden;
        }
        .char-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          image-rendering: pixelated;
        }
        .char-info {
          flex: 1;
          min-width: 0;
        }
        .char-name {
          font-size: 12px;
          font-weight: 500;
          color: ${THEME.text};
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .char-meta {
          font-size: 10px;
          color: ${THEME.textMuted};
          margin-top: 2px;
        }
        .char-actions {
          display: flex;
          gap: 6px;
        }
        .action-btn {
          padding: 4px 8px;
          background: transparent;
          border: 1px solid ${THEME.panelBorder};
          border-radius: 4px;
          color: ${THEME.textMuted};
          font-size: 10px;
          font-family: monospace;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .action-btn:hover {
          border-color: ${THEME.accent};
          color: ${THEME.accent};
        }
        .action-btn.delete:hover {
          border-color: ${THEME.danger};
          color: ${THEME.danger};
        }
        .list-content::-webkit-scrollbar {
          width: 6px;
        }
        .list-content::-webkit-scrollbar-track {
          background: ${THEME.bg};
        }
        .list-content::-webkit-scrollbar-thumb {
          background: ${THEME.panelBorder};
          border-radius: 3px;
        }
        .list-content::-webkit-scrollbar-thumb:hover {
          background: ${THEME.accent};
        }
      </style>
    `;
  }

  async loadCharacters(): Promise<void> {
    try {
      this.characters = await characterStorage.list();
      this.renderList();
    } catch (error) {
      console.error('Failed to load characters:', error);
    }
  }

  private renderList(): void {
    if (!this.container || !this.container.node) return;

    const contentNode = this.container.node.querySelector('.list-content');
    if (!contentNode) return;

    if (this.characters.length === 0) {
      contentNode.innerHTML = `<p class="empty-state" style="text-align: center; padding: 40px 20px; color: ${THEME.textMuted}; font-size: 12px;">暂无保存的角色<br>No saved characters<br><br>创建一个开始吧<br>Create one to get started</p>`;
      return;
    }

    const bodyLabels: Record<string, string> = {
      male: '男', female: '女', teen: '少年', muscular: '肌肉', pregnant: '孕妇'
    };

    contentNode.innerHTML = this.characters.map(char => {
      const date = new Date(char.updatedAt).toLocaleDateString();
      const bodyLabel = bodyLabels[char.bodyType] || char.bodyType[0].toUpperCase();

      return `
          <div class="char-item" data-id="${char.characterId}"">
            <div class="char-thumb">
              ${char.thumbnail ? `<img src="${char.thumbnail}">` : bodyLabel}
            </div>
            <div class="char-info">
              <div class="char-name">${char.name}</div>
              <div class="char-meta">${bodyLabel} | ${date}</div>
            </div>
            <div class="char-actions">
              <button class="action-btn select-btn" data-id="${char.characterId}">加载</button>
              <button class="action-btn delete" data-id="${char.characterId}">删除</button>
            </div>
          </div>
        `;
      }).join('');

    contentNode.querySelectorAll('.select-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (e.target as HTMLElement).dataset.id!;
        this.selectCharacter(id);
      });
    });

    contentNode.querySelectorAll('.action-btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (e.target as HTMLElement).dataset.id!;
        this.deleteCharacter(id);
      });
    });

    contentNode.querySelectorAll('.char-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = (item as HTMLElement).dataset.id!;
        this.selectCharacter(id);
      });
    });

    const refreshBtn = this.container.node?.querySelector('.refresh-btn');
    refreshBtn?.addEventListener('click', () => this.loadCharacters());
  }

  private selectCharacter(id: string): void {
    const character = this.characters.find(c => c.characterId === id);
    if (character) {
      this.config.onCharacterSelected(character);
    }
  }

  private async deleteCharacter(id: string): Promise<void> {
    if (!confirm('确定删除此角色? Delete this character?')) return;

    try {
      await characterStorage.delete(id);
      this.config.onCharacterDeleted(id);
      await this.loadCharacters();
    } catch (error) {
      console.error('Failed to delete character:', error);
    }
  }

  async refresh(): Promise<void> {
    await this.loadCharacters();
  }

  setVisible(visible: boolean): void {
    if (this.container) {
      this.container.setVisible(visible);
    }
  }

  destroy(): void {
    this.container?.destroy();
  }
}
