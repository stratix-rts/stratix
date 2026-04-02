/**
 * DetailPanel Phaser 组件配置
 */

import { Depth } from '../../tokens/depth';
import type { ComponentToken } from '../../types';

export const PhaserDetailPanelConfig: ComponentToken = {
  size: {
    width: 280,
    height: 360,
  },
  layout: {
    padding: 16,
    gap: 12,
  },
  style: {
    background: '#12121a',
    border: '1px solid #2a2a3e',
    borderRadius: '4px',
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.4)',
  },
  depth: Depth.UI_MODAL_CONTENT,
  animation: {
    enter: {
      duration: 250,
      easing: 'ease-out',
    },
  },
} as const;

/**
 * DetailPanel 内部区域配置
 */
export const DetailPanelSections = {
  title: {
    height: 40,
    fontSize: 16,
  },
  avatar: {
    size: 48,
  },
  stats: {
    gap: 8,
    padding: 12,
  },
  skills: {
    maxHeight: 160,
    itemHeight: 32,
  },
} as const;
