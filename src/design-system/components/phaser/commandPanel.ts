/**
 * CommandPanel Phaser 组件配置
 */

import { Depth } from '../../tokens/depth';
import type { ComponentToken } from '../../types';

export const PhaserCommandPanelConfig: ComponentToken = {
  size: {
    width: 320,
    height: 400,
    minWidth: 280,
    minHeight: 360,
  },
  layout: {
    padding: 16,
    gap: 8,
  },
  style: {
    background: '#12121a',
    border: '1px solid #2a2a3e',
    borderRadius: '4px',
    boxShadow: '0 8px 16px rgba(0, 0, 0, 0.5)',
  },
  depth: Depth.UI_MODAL_CONTENT,
  animation: {
    enter: {
      duration: 300,
      easing: 'ease-out',
    },
    exit: {
      duration: 200,
      easing: 'ease-in',
    },
  },
} as const;

/**
 * CommandPanel 内部区域配置
 */
export const CommandPanelSections = {
  header: {
    height: 48,
    padding: 8,
  },
  unitInfo: {
    width: 140,
    padding: 8,
  },
  skills: {
    maxHeight: 200,
    padding: 8,
  },
  commands: {
    height: 64,
    padding: 8,
  },
} as const;
