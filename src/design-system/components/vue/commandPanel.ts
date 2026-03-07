/**
 * CommandPanel Vue 组件配置
 */

import type { ComponentToken } from '../../types';

export const VueCommandPanelConfig: ComponentToken = {
  size: {
    width: '320px',
    height: '400px',
    minWidth: '280px',
    minHeight: '360px',
  },
  layout: {
    padding: 'md',
    gap: 'sm',
  },
  style: {
    background: '#12121a',
    border: '1px solid #2a2a3e',
    borderRadius: 'md',
    boxShadow: '0 8px 16px rgba(0, 0, 0, 0.5)',
  },
  depth: 3000,
  responsive: {
    mobile: {
      size: {
        width: '100%',
        height: '300px',
      },
    },
    tablet: {
      size: {
        width: '280px',
        height: '360px',
      },
    },
  },
  animation: {
    enter: {
      duration: 300,
      easing: 'ease-out',
      from: {
        y: 20,
        opacity: 0,
      },
    },
    exit: {
      duration: 200,
      easing: 'ease-in',
      to: {
        opacity: 0,
      },
    },
  },
} as const;

/**
 * CommandPanel 内部区域配置
 */
export const CommandPanelSections = {
  header: {
    height: '48px',
    padding: 'sm',
  },
  unitInfo: {
    width: '140px',
    padding: 'sm',
  },
  skills: {
    maxHeight: '200px',
    padding: 'sm',
  },
  commands: {
    height: '64px',
    padding: 'sm',
  },
} as const;
